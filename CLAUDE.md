# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**LeadBridge AI** — a multi-agent lead-generation & handover system for the Persian brand *مهدیار هوش‌افزا* (Mahdiyar Hoosh-Afza). It discovers target businesses, extracts their contact channels, analyzes each one's core pain point, scores it, and drafts a deeply personalized outreach message rooted in the brand's identity — always as a **draft requiring human approval**, never auto-sent.

Stack: **Next.js 14 (App Router) · Vercel AI SDK v7 · OpenRouter · Supabase** · TypeScript · Tailwind. UI is **Persian, RTL**; source comments are in Persian.

> This is a rebuild of a previous multi-agent blog system. That prior code lives in `_archive/blog/` — it is **excluded from `tsconfig`** and not part of the build, but it is the canonical reference for the agent-module and orchestrator patterns that phases 3–5 will follow. Read it when implementing new agents.

## Commands

```bash
npm install
cp .env.local.example .env.local   # fill in values, then:
npm run dev      # http://localhost:3000
npm run build
npm run start
npm run lint     # next lint — see caveat below
```

- **No test suite exists** (no vitest/jest configured).
- **No ESLint config or dependency exists.** `next lint` will trigger Next's interactive first-run setup prompt. Don't assume lint runs clean out of the box.
- To run against a real database, execute `supabase/schema.sql` in the Supabase SQL Editor. Without Supabase env vars set, the app runs in an in-memory store (data lost on restart).

## Core architectural principle

Every component is **either an Agent or a Service** (roadmap §6/§7):
- **Agent** = an LLM call for analysis/judgment/creativity.
- **Service** = deterministic code for computation/rules/scoring.
- **The orchestrator is a Service, not an LLM.** Workflow control (order, review loops, conditionals, state transitions, logging) is plain code because it must be predictable, debuggable, and testable. The most common multi-agent mistake — delegating orchestration to an LLM — is explicitly avoided here. See `_archive/blog/src/lib/agents/orchestrator.ts` for the reference implementation of this pattern.

This drives a hard split you must preserve:
- **All tunable deterministic parameters** (scoring weights, thresholds, market/ICP definitions, limits, channel priority) live in [src/lib/config.ts](src/lib/config.ts). Change behavior there, not scattered in agents.
- **All brand identity** (the 7 official services, personas, voice, banned/approved words, portfolio) lives in [src/lib/brand.ts](src/lib/brand.ts). This single file is the "shared context" injected into agent prompts. Repurposing the whole system for another brand should require editing essentially only this file.

## How the pieces fit

**AI core — [src/lib/ai.ts](src/lib/ai.ts).** Every agent goes through OpenRouter via `@ai-sdk/openai-compatible` (one key, any model). Two primitives are the foundation of all agents:
- `runAgentText` — free-form text output (used by the message Writer).
- `runAgentJSON` — structured output with **Zod validation + one automatic retry** that feeds the parse error back to the model. Do **not** rely on model-native JSON mode (inconsistent across OpenRouter models); this validate-and-retry loop is the intended pattern. JSON is manually extracted from the response before parsing.
- A `fetch` wrapper forces `reasoning: { effort: "low" }` on every request, so reasoning-heavy models don't burn the whole token budget.
- Model is `PIPELINE_MODEL` (default `google/gemini-2.5-flash`) for all agents; `WRITER_MODEL` optionally overrides just the Writer.

**Storage — [src/lib/store/](src/lib/store/) (Adapter pattern).** The entire system talks only to the `LeadStore` interface ([types.ts](src/lib/store/types.ts)). `getStore()` auto-selects `SupabaseStore` (production) if Supabase env vars are present, else `MemoryStore` (dev fallback, persisted on `globalThis` to survive hot-reloads). **Agents and the orchestrator must never touch the database directly** — always go through the store.
- Domain types are **camelCase**; DB columns are **snake_case**. All conversion is centralized in [supabase.ts](src/lib/store/supabase.ts) via `toRow`/`fromRow` pairs. When adding a field, update the type, both mappers, and `supabase/schema.sql`.
- The `Lead.status` field is a 16-state machine (`NEW → … → HANDED_OVER`) defined in `types.ts` and mirrored by a `check` constraint in the schema — keep the two in sync.

**Self-improvement — [src/lib/agents/lessons.ts](src/lib/agents/lessons.ts).** Before each agent runs, `lessonsBlockFor(agentName)` pulls that agent's active `lessons` rows and appends them to its system prompt. A critic agent (and human feedback) writes new lessons back. This lets the system improve across runs without code changes. New agents should inject this block into their system prompt.

**Agent module pattern** (see `_archive/blog/src/lib/agents/writer.ts`): each agent is a file exporting (a) an async system-prompt builder that composes brand blocks + `lessonsBlockFor(...)`, and (b) a `run…` function that calls `runAgentText`/`runAgentJSON`. Server-only modules start with `import "server-only"`.

## Build status (phased)

Implemented directories reflect the phase. `src/lib/integrations/` and most of `src/lib/agents/` do **not exist yet** — they are created in later phases.

- ✅ **Phase 1** — infrastructure + brand + data (store/CRM, schema, brand, config).
- ⏳ Phase 2 — lead discovery (Google Places New + Instagram Graph `business_discovery`) + channel extraction + leads dashboard.
- ⏳ Phase 3 — analysis + scoring + service/portfolio selection.
- ⏳ Phase 4 — message generation + critic + human approval.
- ⏳ Phase 5 — handover + self-improvement + semi-automatic sending.

## Spec source of truth

[LeadBridge_AI_Master_Execution_Roadmap_FA.md](LeadBridge_AI_Master_Execution_Roadmap_FA.md) is the master spec. Code comments cite it by section (e.g. §6 Agent-vs-Workflow, §9 data model, §10 state machine, §11.4 scoring, §22 message rules, §23 critic rubric). Consult the relevant section before implementing a phase.

## Hard product constraints (roadmap §3.3)

These are non-negotiable and enforced in code/config:
- Official APIs only — Google Places (New) + Instagram Graph `business_discovery` (public data only). No unbounded scraping, no mass cold DMs.
- Every message is a **draft + human approval** before sending.
- Messages contain **no price, discount, or contract** claims; personalization must be grounded in each business's real, evidenced pain point (see `BANNED_WORDS` / critic `accuracy` + `constraints` criteria).

## Conventions

- `@/*` path alias → `./src/*`.
- Tailwind design tokens only — **no raw hex in components**. Palette (`pine`/`brass`/`bone`/`brand`) and fonts (Estedad for headings, Vazirmatn for body, both self-hosted in `public/fonts/`) are defined in [tailwind.config.ts](tailwind.config.ts).
- Persian digits (۱۲۳) in user-facing text; `dir="rtl"` / `lang="fa"` on the document.
  - **Exception**: the phone number and URLs in `MESSAGE_SIGNATURE` stay in Latin digits — that text gets copied and pasted into WhatsApp/Telegram, and `۰۹۱۳۲۱۶۰۴۷۰` is not dialable.
- The `/studio` dashboard and admin APIs are gated by `STUDIO_PASSWORD` via [src/lib/auth.ts](src/lib/auth.ts) (open when the var is unset — dev mode).

## How to report to the owner

The owner reads every report and acts on it. Write like a colleague, not an assistant.

- **No assistant filler.** Skip "قطعاً"، "البته"، "امیدوارم کمک کند"، "خوشحال می‌شوم اگر"، and any restating of the request before answering. Start with the finding.
- **Lead with what changed or what was found**, not with what you were asked to do.
- **No inflated adjectives.** "بهبود چشمگیر"، "کاملاً بهینه"، "بی‌نقص" mean nothing. Give the number, the file, or the observed behavior instead.
- **Don't narrate the obvious.** If a diff shows the change, don't also describe it line by line. Explain only the parts whose *reason* isn't visible in the code.
- **Formatting is not decoration.** Headings and bullets only when the content has real structure. A three-sentence answer is a paragraph, not a bulleted list.
- **Vary sentence length**; avoid three-part lists and «نه تنها… بلکه…» constructions. Uniform rhythm reads as machine output.
- **Say what is untested.** Anything not verified against live data is a claim, not a result — label it that way. This project has repeatedly proven that only live runs catch real bugs (null `reviews_count`, stale affluence scores, stuck leads).
- **Report failures plainly**, with the actual output. Never soften a failed step into a partial success.
