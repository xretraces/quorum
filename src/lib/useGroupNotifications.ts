// In-app notifications for the current group, driven by Supabase Realtime (no push, no paid services).
// Unread state is stored in localStorage keyed by groupId + memberId.
// The first time a device sees a group (as viewer, new joiner or host), everything that already happened is marked
// read: it still shows in the list as history, but only events that arrive after you got here count toward the badge.
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

const META_PREFIX = "pp:notif-meta:";

// baselined: the backlog that existed on the first visit has been marked read.
type Meta = { firstSeen: Record<string, number>; readKeys: string[]; baselined: boolean };

function storageKey(groupId: string, memberId: string | null) {
  return `${META_PREFIX}${groupId}:${memberId ?? "anon"}`;
}

function loadMeta(groupId: string, memberId: string | null): Meta {
  try {
    const raw = localStorage.getItem(storageKey(groupId, memberId));
    if (!raw) return { firstSeen: {}, readKeys: [], baselined: false };
    const j = JSON.parse(raw) as Partial<Meta>;
    return {
      firstSeen: j.firstSeen && typeof j.firstSeen === "object" ? j.firstSeen : {},
      readKeys: Array.isArray(j.readKeys) ? j.readKeys : [],
      // State saved by an older build means this device has been here before: keep its read state as is.
      baselined: typeof j.baselined === "boolean" ? j.baselined : true,
    };
  } catch {
    return { firstSeen: {}, readKeys: [], baselined: false };
  }
}

function saveMeta(groupId: string, memberId: string | null, meta: Meta) {
  // Cap maps so localStorage stays small.
  const keys = Object.keys(meta.firstSeen);
  if (keys.length > 200) {
    const keep = keys.sort((a, b) => (meta.firstSeen[b] ?? 0) - (meta.firstSeen[a] ?? 0)).slice(0, 200);
    const next: Record<string, number> = {};
    for (const k of keep) next[k] = meta.firstSeen[k];
    meta = { firstSeen: next, readKeys: meta.readKeys.filter((k) => k in next).slice(-200), baselined: meta.baselined };
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

type Loaded = { key: string; group: Group | null; members: Member[]; plans: Plan[] };

export function useGroupNotifications(groupId: string | null | undefined) {
  const meId = groupId ? myMemberId(groupId) : null;
  const curKey = groupId ? storageKey(groupId, meId) : null;
  // Data is tagged with the group+member it was loaded for, so a stale response (or the previous group's data right
  // after navigating to another group) is never derived or baselined under the wrong key.
  const [data, setData] = useState<Loaded | null>(null);
  const metaRef = useRef<Meta>({ firstSeen: {}, readKeys: [], baselined: false });
  const metaKeyRef = useRef<string | null>(null);
  // Load the stored read/first-seen state synchronously for this group+member. Loading it in the effect (after the
  // first render) let the first render's saveMeta() overwrite it with an empty state, so every reload showed all
  // old events as unread again.
  const metaFor = useCallback((gid: string, mid: string | null) => {
    const k = storageKey(gid, mid);
    if (metaKeyRef.current !== k) {
      metaRef.current = loadMeta(gid, mid);
      metaKeyRef.current = k;
    }
    return metaRef.current;
  }, []);
  const [readKeys, setReadKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!groupId) {
      setData(null);
      setReadKeys([]);
      return;
    }
    const key = storageKey(groupId, meId);
    setReadKeys(metaFor(groupId, meId).readKeys);
    let alive = true;

    const load = async () => {
      const [g, m, p] = await Promise.all([
        supabase.from("groups").select("*").eq("id", groupId).maybeSingle(),
        supabase.from("members").select("*").eq("group_id", groupId).order("created_at"),
        supabase.from("plans").select("*").eq("group_id", groupId).order("option_index"),
      ]);
      if (!alive) return;
      setData({ key, group: (g.data as Group) ?? null, members: (m.data ?? []) as Member[], plans: (p.data ?? []) as Plan[] });
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
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [groupId, meId, metaFor]);

  const loaded = !!groupId && !!data && data.key === curKey;

  const items = useMemo(() => {
    if (!groupId || !loaded || !data) return [] as GroupNotification[];
    const meta = metaFor(groupId, meId);
    const list = derive(data.group, data.members, data.plans, meId, meta);
    if (!meta.baselined) {
      // First real load for this group on this device: what already happened is history, not news.
      meta.readKeys = Array.from(new Set([...meta.readKeys, ...list.map((n) => n.key)]));
      meta.baselined = true;
    }
    // Only saved once real data is in, so an empty first render can't store a baseline-less state.
    saveMeta(groupId, meId, meta);
    return list;
  }, [groupId, meId, loaded, data, metaFor]);

  // Read from the ref (the baseline above updates it during render); readKeys state just triggers re-renders.
  const readSet = useMemo(
    () => new Set(metaRef.current.readKeys),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, readKeys],
  );
  const unread = useMemo(() => items.filter((n) => !readSet.has(n.key)).length, [items, readSet]);

  const markRead = useCallback(() => {
    // Before the first load there is nothing to mark; replacing readKeys with [] here would un-read everything.
    if (!groupId || !loaded) return;
    const keys = items.map((n) => n.key);
    metaRef.current = { ...metaRef.current, readKeys: keys, baselined: true };
    saveMeta(groupId, meId, metaRef.current);
    setReadKeys(keys);
  }, [groupId, meId, items, loaded]);

  return {
    items,
    unread,
    markRead,
    hasGroup: !!groupId,
    empty: !groupId || items.length === 0,
    isUnread: (key: string) => !readSet.has(key),
  };
}
