// "Add to calendar": one .ics event per stop of the winning plan. Plans say "Sat 2:00 PM" with no date, so the
// day resolves to the next such weekday (today counts). Times are floating local time (the phone's time zone).
import { catalogEntry, parseStart } from "./booking";
import type { Plan } from "./supabase";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

function dateFor(day: string | null, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const want = day ? DAYS.indexOf(day.slice(0, 3).toLowerCase()) : -1;
  if (want >= 0) d.setDate(d.getDate() + ((want - d.getDay() + 7) % 7));
  return d;
}

export function planToIcs(plan: Plan, groupName: string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Quorum//HackGT//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  plan.items.forEach((it, i) => {
    const t = parseStart(it.start_time);
    const start = dateFor(t.day);
    const mins = t.minutes ?? 12 * 60 + i * 120;
    start.setMinutes(mins);
    const c = catalogEntry(it.catalog_id);
    const end = new Date(start.getTime() + (c?.duration_minutes ?? 90) * 60_000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${plan.id}-${i}@quorum`,
      `DTSTAMP:${utc(new Date())}`,
      `DTSTART:${local(start)}`,
      `DTEND:${local(end)}`,
      `SUMMARY:${esc(`${it.name} (${groupName})`)}`,
      `LOCATION:${esc(`${it.name}${c ? `, ${c.neighborhood}` : ""}, Atlanta, GA`)}`,
      `DESCRIPTION:${esc([plan.title, it.note, c?.transit_note].filter(Boolean).join("\n"))}`,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function downloadIcs(plan: Plan, groupName: string) {
  const blob = new Blob([planToIcs(plan, groupName)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${plan.title.replace(/[^\w -]+/g, "").trim() || "quorum-plan"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
