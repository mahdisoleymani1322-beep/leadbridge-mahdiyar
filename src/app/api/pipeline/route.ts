import { NextRequest } from "next/server";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import { isConfigured } from "@/lib/ai";
import { runLeadPipeline, runLeadStep } from "@/lib/agents/orchestrator";
import { scoreAffluence } from "@/lib/agents/affluence";
import { AFFLUENCE_THRESHOLDS } from "@/lib/config";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/pipeline { leadId } — اجرای خط تولید تحلیل روی یک لید
 * (تحلیل → امتیاز → انتخاب خدمت → انتخاب نمونه‌کار)
 *
 * یا { campaignId, limit } — پردازش دسته‌ای چند لید NEW همان کمپین.
 */
export async function POST(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();

  if (!isConfigured()) {
    return Response.json(
      { error: "OPENROUTER_API_KEY تنظیم نشده — ایجنت‌های تحلیل نیاز به کلید دارند." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));

  try {
    // حالت تکی — **یک گام** در هر درخواست (برای دکمه‌های «تولید پیام» و «تحلیل لید»).
    // مثل حالت کمپین، کلاینت گام‌ها را پشت‌سرهم می‌زند تا از سقف ۶۰ ثانیه رد نشود.
    //
    // force: دروازه‌ی توان مالی نادیده گرفته می‌شود. کلیک انسان روی یک ردیف
    // مشخص، اراده‌ی صریح است و بر غربال خودکار مقدم.
    if (typeof body.leadId === "string" && body.leadId && body.step === true) {
      /*
        گارد سرور برای «تولید پیام».

        دکمه‌ی تولید پیام همین endpoint را صدا می‌زند، پس بدون این چک یک لید
        تحلیل‌نشده به‌جای پیام **تحلیل** می‌شد و سهمیه‌ی مدل بی‌اجازه خرج
        می‌شد. قفلِ سمت کلاینت (aria-disabled) فقط UI است؛ تصمیم خرج توکن
        باید سمت سرور گرفته شود.
      */
      if (body.only === "message") {
        const lead = await getStore().getLead(body.leadId);
        if (!lead) return Response.json({ error: "لید یافت نشد." }, { status: 404 });
        if (lead.status !== "READY_FOR_MESSAGE") {
          return Response.json(
            {
              error:
                `تولید پیام برای «${lead.businessName}» ممکن نیست: هنوز تحلیل و امتیازدهی نشده ` +
                `(وضعیت فعلی: ${lead.status}). اول «تحلیل لید» را بزنید.`,
            },
            { status: 409 }
          );
        }
      }

      const step = await runLeadStep(body.leadId, { force: body.force === true });
      return Response.json({ step, done: step.done });
    }

    // حالت تکی — اجرای کامل تحلیل تا انتخاب نمونه‌کار (بدون گام پیام)
    if (typeof body.leadId === "string" && body.leadId) {
      const result = await runLeadPipeline(body.leadId);
      return Response.json({ results: [result] });
    }

    // حالت کمپین — **یک گام** در هر درخواست.
    //
    // چرا گام‌به‌گام: اجرای کل یک لید ~۳۵ ثانیه است و درخواست HTTP آن‌قدر باز
    // می‌ماند که شبکه‌های کند/پروکسی قطعش می‌کنند (NetworkError) یا به سقف
    // ۶۰ ثانیه‌ای تابع می‌خورد (504). هر گام ~۱۰ ثانیه است و کلاینت گام‌ها را
    // پشت‌سرهم می‌زند تا همه‌ی لیدها تمام شوند.
    if (typeof body.campaignId === "string" && body.campaignId) {
      const store = getStore();

      // حالت «فقط پیام»: دکمه‌ی «تولید پیام برای همه‌ی لیدها» فقط لیدهایی را
      // هدف می‌گیرد که تحلیل و امتیازدهی شده‌اند و منتظر پیام‌اند — تا با
      // دکمه‌ی تحلیل گروهی تداخل نکند و سهمیه‌ی مدل صرف تحلیل نشود.
      const onlyMessage = body.only === "message";

      /*
        دامنه‌ی کار: «منتخب» یا کل کمپین.

        هر دو دکمه‌ی گروهی داشبورد فقط روی فهرست منتخب کار می‌کنند — جریان کار
        مالک این است: انتخاب دستی → منتخب → تحلیل همه → پیام همه. مسیر
        کل‌کمپین برای کرون روزانه (فاز ۶) دست‌نخورده می‌ماند.
      */
      const shortlistOnly = body.scope === "shortlist";
      const pickScope = (rows: Awaited<ReturnType<typeof store.listLeads>>) =>
        shortlistOnly ? rows.filter((l) => l.shortlisted) : rows;

      // حالت «فقط توان مالی» — **صفر توکن**. برای همه‌ی لیدهایی که نمره ندارند
      // (لیدهای دستی یا قدیمی) یک‌جا محاسبه می‌کند تا پیش از خرج هر توکنی
      // بدانی کدام لیدها ارزش تحلیل دارند. یک درخواست، بدون فراخوان مدل.
      if (body.only === "affluence") {
        const all = await store.listLeads({ campaignId: body.campaignId, limit: 1000 });
        const names = all.map((l) => l.businessName);

        /*
          **همیشه از نو محاسبه می‌شود، نه فقط لیدهای بدون نمره.**

          نسخه‌ی اول این کد شرط `affluenceScore == null` داشت و یک باگ واقعی
          ساخت: لیدهایی که با الگوریتم قدیمی نمره گرفته بودند نمره‌ی بیات‌شان
          را برای همیشه نگه می‌داشتند. نمونه‌ی واقعی: یک کلینیک با ۶ کانال
          ارتباط روی ۴۵ (نمره‌ی الگوریتم قدیم) مانده بود، در حالی که با
          الگوریتم فعلی ۶۰ می‌گیرد.

          محاسبه‌ی دوباره بی‌خطر است: scoreAffluence یک تابع خالص روی داده‌ی
          ذخیره‌شده است — صفر توکن و idempotent.
        */
        let changed = 0;
        const finalScores: number[] = [];
        for (const l of all) {
          const aff = scoreAffluence(l, { siblingNames: names });
          if (aff.score !== l.affluenceScore) {
            await store.updateLead(l.id, {
              affluenceScore: aff.score,
              affluenceSignals: aff.signals,
            });
            changed++;
          }
          finalScores.push(aff.score);
        }

        return Response.json({
          only: "affluence",
          changed, // چند لید نمره‌اش عوض شد
          total: all.length,
          worthAnalyzing: finalScores.filter((s) => s >= AFFLUENCE_THRESHOLDS.analyze).length,
          threshold: AFFLUENCE_THRESHOLDS.analyze,
          done: true,
        });
      }

      if (onlyMessage) {
        const waiting = pickScope(
          await store.listLeads({
            campaignId: body.campaignId,
            status: "READY_FOR_MESSAGE",
            limit: 500,
          })
        );
        const target = waiting[0];
        if (!target) return Response.json({ step: null, remaining: 0, done: true });

        // force در دامنه‌ی منتخب: انتخاب دستی انسان خودش اراده‌ی صریح است
        const step = await runLeadStep(target.id, { force: shortlistOnly });
        return Response.json({
          step,
          businessName: target.businessName,
          // این لید تا وقتی done نشود همان‌جا می‌ماند، پس شمارش بعد از اتمامش کم می‌شود
          remaining: step.done ? waiting.length - 1 : waiting.length,
          done: false,
        });
      }

      // لیدهای نیمه‌تمام اولویت دارند تا کار رهاشده نماند:
      //   SCORED            → گام خدمت/نمونه‌کار مانده
      //   READY_FOR_MESSAGE → گام تولید پیام مانده (فاز ۴)
      // بعد سراغ لید تحلیل‌نشده‌ی بعدی می‌رویم.
      const scored = pickScope(
        await store.listLeads({ campaignId: body.campaignId, status: "SCORED", limit: 500 })
      ).slice(0, 1);
      const readyForMessage = scored.length
        ? []
        : pickScope(
            await store.listLeads({
              campaignId: body.campaignId,
              status: "READY_FOR_MESSAGE",
              limit: 500,
            })
          ).slice(0, 1);
      const freshRaw = pickScope(
        await store.listLeads({ campaignId: body.campaignId, status: "NEW", limit: 500 })
      );

      // **مهم‌ترین بخش صرفه‌جویی:** لیدها به ترتیب نزولیِ توان مالی پردازش
      // می‌شوند، نه به ترتیب تاریخ. اگر سهمیه‌ی روزانه وسط کار تمام شود،
      // ارزشمندترین لیدها تحلیل شده‌اند نه یک مشت لید تصادفی.
      const fresh = [...freshRaw].sort((a, b) => (b.affluenceScore ?? 0) - (a.affluenceScore ?? 0));

      const target = scored[0] ?? readyForMessage[0] ?? fresh[0];
      if (!target) {
        return Response.json({ step: null, remaining: 0, done: true });
      }

      // force در دامنه‌ی منتخب: لیدی که انسان دستی انتخاب کرده نباید با
      // دروازه‌ی توان مالی کنار گذاشته شود — انتخاب او خودش اراده‌ی صریح است.
      const step = await runLeadStep(target.id, { force: shortlistOnly });
      // «باقی‌مانده» = لیدهایی که هنوز تحلیل نشده‌اند (برای نمایش پیشرفت).
      // دروازه‌ی توان مالی هم لید را از صف NEW خارج می‌کند، پس آن هم می‌شمارد.
      const consumed = step.ran === "analysis" || step.ran === "affluence-gate";
      const remaining = consumed ? fresh.length - 1 : fresh.length;

      return Response.json({
        step,
        businessName: target.businessName,
        affluenceScore: target.affluenceScore,
        remaining,
        done: false,
      });
    }

    return Response.json({ error: "leadId یا campaignId لازم است." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
