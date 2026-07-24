import type { ContactChannels } from "@/lib/store/types";

/**
 * تایپ مشترک نتیجه‌ی کشف — مستقل از منبع (Google Places یا OpenStreetMap).
 * جریان کشف فقط با این تایپ کار می‌کند تا تعویض منبع، بقیه‌ی کد را نشکند.
 */
export type DiscoveredPlace = {
  /** شناسه‌ی یکتای منبع (Google placeId یا osm type/id) */
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewsCount: number | null;
  /** لینک عمومی منبع (Google Maps یا OSM) */
  mapsUri: string | null;
  typeLabel: string | null;
  businessStatus: string | null;
  /** هندل اینستاگرام اگر منبع مستقیم داشت (مثلاً tag اینستاگرام در OSM) */
  instagramHandle?: string | null;
  /** کانال‌های ارتباطیِ آماده از خود منبع (تگ‌های contact:* در OSM) */
  seedChannels?: Partial<ContactChannels>;
};
