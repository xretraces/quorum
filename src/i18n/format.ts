// Plan times come from Grok/the catalog as English strings like "Sat 6:00 PM": show them in the UI language.
import { parseStart } from "../lib/booking";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const SUNDAY = [2026, 0, 4] as const; // any Sunday

/** `{ day, time }` localized, e.g. ("Sat 6:00 PM", "es") -> { day: "sáb", time: "18:00" }. Unparseable input is returned as is. */
export function localStart(raw: string, lang: string): { day: string | null; time: string } {
  const p = parseStart(raw);
  if (p.minutes === null) return { day: p.day, time: p.time };
  const [y, m, d] = SUNDAY;
  const time = new Date(y, m, d, Math.floor(p.minutes / 60), p.minutes % 60).toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" });
  const idx = p.day ? DAYS.indexOf(p.day.toLowerCase()) : -1;
  const day = idx < 0 ? p.day : new Date(y, m, d + idx).toLocaleDateString(lang, { weekday: "short" });
  return { day, time };
}
