// "Your groups" on the home screen: every group this device created or joined, newest activity first.
// One PostgREST query returns each group with its member count; Realtime keeps it fresh.
import { useCallback, useEffect, useState } from "react";
import { useLanguage, useT } from "../i18n/hooks";
import type { TFunction } from "../i18n/context";
import { forgetGroup, myGroupIds, statusBadge, supabase } from "../lib/supabase";

type Row = {
  id: string; name: string; status: string; created_at: string;
  members: { count: number }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ago(iso: string, lang: string, t: TFunction) {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s > -45) return t("groups.justNow");
  for (const [unit, secs] of [["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  }
  return rtf.format(Math.round(s / 60), "minute");
}

const activityOf = (g: Row) => g.created_at;

export function YourGroups({ onOpen }: { onOpen: (groupId: string) => void }) {
  const t = useT();
  const { lang } = useLanguage();
  const [ids, setIds] = useState(() => myGroupIds());
  const [groups, setGroups] = useState<Row[] | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    const all = myGroupIds();
    const valid = all.filter((id) => UUID.test(id));
    all.filter((id) => !UUID.test(id)).forEach(forgetGroup);
    if (valid.length === 0) {
      setIds([]);
      return setGroups([]);
    }
    const { data, error } = await supabase
      .from("groups")
      .select("id,name,status,created_at,members(count)")
      .in("id", valid);
    if (error) return console.error("Couldn't load your groups", error); // keep the last good list and the stored ids
    const rows = data as Row[];
    const found = new Set(rows.map((g) => g.id));
    valid.filter((id) => !found.has(id)).forEach(forgetGroup); // deleted groups
    setIds(valid.filter((id) => found.has(id)));
    setGroups(rows.sort((a, b) => activityOf(b).localeCompare(activityOf(a))));
  }, []);

  const key = ids.slice().sort().join(",");

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => setTick((t) => t + 1), 60_000); // re-render relative times
    return () => {
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!key) return;
    const inList = `in.(${key})`;
    const channel = supabase
      .channel(`your-groups-${key}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `id=${inList}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `group_id=${inList}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [key, load]);

  if (ids.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-center text-sm font-semibold text-navy/80">{t("groups.title")}</h2>
      {groups === null ? (
        <p className="py-3 text-center text-sm text-navy/70">{t("common.loading")}</p>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => {
            const s = statusBadge(g.status);
            const count = g.members[0]?.count ?? 0;
            return (
              <li key={g.id}>
                <button
                  onClick={() => onOpen(g.id)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-lg border-2 border-navy bg-white px-4 py-3 text-start text-navy transition-[transform,box-shadow] duration-100 hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_0_var(--color-navy)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span dir="auto" className="truncate font-semibold">{g.name}</span>
                      <span className={`q-tag ${s.cls}`}>{t(s.labelKey)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-navy/70">{t("groups.people", { count })}</p>
                  </div>
                  <div className="shrink-0 text-end text-xs text-navy/70">
                    <div>{ago(activityOf(g), lang, t)}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
