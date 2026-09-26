// "Your groups" on the home screen: every group this device created or joined, newest activity first.
// One PostgREST query returns each group with its member count and latest message; Realtime keeps it fresh.
import { useCallback, useEffect, useState } from "react";
import { forgetGroup, myGroupIds, supabase } from "../lib/supabase";

type Row = {
  id: string; name: string; status: string; created_at: string;
  members: { count: number }[];
  messages: { sender_name: string; text: string; created_at: string }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS: Record<string, { label: string; cls: string }> = {
  planning: { label: "Chatting", cls: "bg-sky-100 text-sky-700" },
  voting: { label: "Voting", cls: "bg-amber-100 text-amber-700" },
  holding: { label: "Locked", cls: "bg-indigo-100 text-indigo-700" },
  captured: { label: "Booked", cls: "bg-emerald-100 text-emerald-700" },
  partially_captured: { label: "Partly booked", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Cancelled", cls: "bg-gray-100 text-gray-600" },
};

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
function ago(iso: string) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s > -45) return "just now";
  for (const [unit, secs] of [["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  }
  return rtf.format(Math.round(s / 60), "minute");
}

const activityOf = (g: Row) => g.messages[0]?.created_at ?? g.created_at;

export function YourGroups({ onOpen }: { onOpen: (groupId: string) => void }) {
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
      .select("id,name,status,created_at,members(count),messages(sender_name,text,created_at)")
      .in("id", valid)
      .order("created_at", { referencedTable: "messages", ascending: false })
      .limit(1, { referencedTable: "messages" });
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
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `group_id=${inList}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `group_id=${inList}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [key, load]);

  if (ids.length === 0) return null;

  return (
    <section className="rounded-2xl bg-white p-4 shadow-lg">
      <h2 className="mb-2 px-2 text-xl font-bold">Your Groups</h2>
      {groups === null ? (
        <p className="px-2 py-3 text-sm text-gray-500">Loading…</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {groups.map((g) => {
            const s = STATUS[g.status] ?? { label: g.status, cls: "bg-gray-100 text-gray-600" };
            const last = g.messages[0];
            const count = g.members[0]?.count ?? 0;
            return (
              <li key={g.id}>
                <button
                  onClick={() => onOpen(g.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-indigo-50 active:bg-indigo-100"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-gray-900">{g.name}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-gray-500">
                      {last ? (
                        <>
                          <span className="font-medium text-gray-700">{last.sender_name}:</span> {last.text}
                        </>
                      ) : (
                        "No messages yet"
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-gray-500">
                    <div>{ago(activityOf(g))}</div>
                    <div className="mt-0.5">👥 {count}</div>
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
