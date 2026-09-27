// In-app notifications for the current group, driven by Supabase Realtime (no push, no paid services).
// Unread state is stored in localStorage keyed by groupId + memberId.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Group, type Member, type Plan, myMemberId, supabase } from "./supabase";

export type NotifKind =
  | "joined"
  | "ready"
  | "allReady"
  | "plansReady"
  | "voted"
  | "winner";

export type GroupNotification = {
  id: string;
  kind: NotifKind;
  at: number; // ms epoch when first observed (stable across reloads)
  name?: string;
  key: string;
};

const READ_PREFIX = "pp:notif-read:";
const META_PREFIX = "pp:notif-meta:";

type Meta = { firstSeen: Record<string, number>; readKeys: string[] };

function storageKey(groupId: string, memberId: string | null) {
  return `${META_PREFIX}${groupId}:${memberId ?? "anon"}`;
}

function loadMeta(groupId: string, memberId: string | null): Meta {
  try {
    const raw = localStorage.getItem(storageKey(groupId, memberId));
    if (!raw) return { firstSeen: {}, readKeys: [] };
    const j = JSON.parse(raw) as Meta;
    return {
      firstSeen: j.firstSeen && typeof j.firstSeen === "object" ? j.firstSeen : {},
      readKeys: Array.isArray(j.readKeys) ? j.readKeys : [],
    };
  } catch {
    return { firstSeen: {}, readKeys: [] };
  }
}

function saveMeta(groupId: string, memberId: string | null, meta: Meta) {
  // Cap maps so localStorage stays small.
  const keys = Object.keys(meta.firstSeen);
  if (keys.length > 200) {
    const keep = keys.sort((a, b) => (meta.firstSeen[b] ?? 0) - (meta.firstSeen[a] ?? 0)).slice(0, 200);
    const next: Record<string, number> = {};
    for (const k of keep) next[k] = meta.firstSeen[k];
    meta = { firstSeen: next, readKeys: meta.readKeys.filter((k) => k in next).slice(-200) };
  }
  localStorage.setItem(storageKey(groupId, memberId), JSON.stringify(meta));
}

function memberAt(m: Member): number {
  const c = (m as { created_at?: string }).created_at;
  return c ? new Date(c).getTime() : 0;
}

function planAt(p: Plan): number {
  return p.created_at ? new Date(p.created_at).getTime() : 0;
}

function ensureSeen(meta: Meta, key: string, hint: number): number {
  if (meta.firstSeen[key]) return meta.firstSeen[key];
  const at = hint > 0 ? hint : Date.now();
  meta.firstSeen[key] = at;
  return at;
}

function derive(
  group: Group | null,
  members: Member[],
  plans: Plan[],
  meId: string | null,
  meta: Meta,
): GroupNotification[] {
  const items: GroupNotification[] = [];

  const push = (kind: NotifKind, key: string, hint: number, name?: string) => {
    const at = ensureSeen(meta, key, hint);
    items.push({ id: key, kind, at, name, key });
  };

  for (const m of members) {
    if (m.id === meId) continue;
    push("joined", `joined:${m.id}`, memberAt(m), m.display_name);
    if (m.prefs_ready) push("ready", `ready:${m.id}`, memberAt(m) || Date.now(), m.display_name);
    if (m.vote_plan_id) push("voted", `voted:${m.id}:${m.vote_plan_id}`, 0, m.display_name);
  }

  const readyCount = members.filter((m) => m.prefs_ready).length;
  if (members.length >= 2 && readyCount === members.length) {
    push("allReady", `allReady:${members.map((m) => m.id).sort().join(",")}`, 0);
  }

  if (plans.length > 0) {
    const first = plans.reduce((a, b) => (planAt(a) <= planAt(b) ? a : b));
    push("plansReady", `plans:${plans.map((p) => p.id).sort().join(",")}`, planAt(first));
  }

  if (group?.selected_plan_id) {
    const w = plans.find((p) => p.id === group.selected_plan_id);
    push("winner", `winner:${group.selected_plan_id}`, 0, w?.title);
  }

  items.sort((a, b) => b.at - a.at);
  return items.slice(0, 40);
}

export function useGroupNotifications(groupId: string | null | undefined) {
  const meId = groupId ? myMemberId(groupId) : null;
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const metaRef = useRef<Meta>({ firstSeen: {}, readKeys: [] });
  const [readKeys, setReadKeys] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!groupId) {
      setGroup(null);
      setMembers([]);
      setPlans([]);
      setReadKeys([]);
      return;
    }
    const meta = loadMeta(groupId, meId);
    metaRef.current = meta;
    setReadKeys(meta.readKeys);

    // Migrate legacy read-at timestamp if present.
    const legacy = localStorage.getItem(`${READ_PREFIX}${groupId}:${meId ?? "anon"}`);
    if (legacy) {
      /* keep for one release; ignore value — keys drive unread now */
    }

    const load = async () => {
      const [g, m, p] = await Promise.all([
        supabase.from("groups").select("*").eq("id", groupId).maybeSingle(),
        supabase.from("members").select("*").eq("group_id", groupId).order("created_at"),
        supabase.from("plans").select("*").eq("group_id", groupId).order("option_index"),
      ]);
      setGroup((g.data as Group) ?? null);
      setMembers((m.data ?? []) as Member[]);
      setPlans((p.data ?? []) as Plan[]);
      setTick((t) => t + 1);
    };
    load();

    const filter = `group_id=eq.${groupId}`;
    const channel = supabase
      .channel(`notif-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "members", filter }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "plans", filter }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `id=eq.${groupId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, meId]);

  const items = useMemo(() => {
    if (!groupId) return [] as GroupNotification[];
    const list = derive(group, members, plans, meId, metaRef.current);
    saveMeta(groupId, meId, metaRef.current);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, group, members, plans, meId, tick]);

  const readSet = useMemo(() => new Set(readKeys), [readKeys]);
  const unread = useMemo(() => items.filter((n) => !readSet.has(n.key)).length, [items, readSet]);

  const markRead = useCallback(() => {
    if (!groupId) return;
    const keys = items.map((n) => n.key);
    metaRef.current = { ...metaRef.current, readKeys: keys };
    saveMeta(groupId, meId, metaRef.current);
    setReadKeys(keys);
  }, [groupId, meId, items]);

  return {
    items,
    unread,
    markRead,
    hasGroup: !!groupId,
    empty: !groupId || items.length === 0,
    isUnread: (key: string) => !readSet.has(key),
  };
}
