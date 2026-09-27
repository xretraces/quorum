// src/App.tsx: simple routing without a router dependency.
// /  home · /join/:code  join · /g/:id  lobby, then plans/voting/winner · /g/:id/answers  this member's private answers
// Language control lives in QuorumHeader (CreateGroup / JoinGroup / GroupBoard) — no floating LanguageSwitcher.
import { useCallback, useEffect, useState } from "react";
import { CreateGroup } from "./components/CreateGroup";
import { JoinGroup } from "./components/JoinGroup";
import { GroupBoard, type Navigate } from "./components/GroupBoard";

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  // opts.replace: swap the current history entry (e.g. /join/… -> answers, so Back doesn't reopen the join page).
  // opts.state: history state, e.g. { fromLobby: true } so the answers page can return with history.back().
  const go = useCallback((p: string, opts?: Navigate) => {
    if (opts?.replace) window.history.replaceState(opts.state ?? {}, "", p);
    else window.history.pushState(opts?.state ?? {}, "", p);
    setPath(p);
  }, []);

  const toGroup = useCallback((id: string) => go(`/g/${id}`), [go]);
  // A new member goes straight to their private answers; someone who had already joined on this device (or a closed
  // group) goes to the lobby/board.
  const joined = useCallback((id: string, fresh: boolean) => go(fresh ? `/g/${id}/answers` : `/g/${id}`, { replace: true }), [go]);

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const join = path.match(/^\/join\/([\w-]+)/);
  const board = path.match(/^\/g\/([\w-]+)(\/answers)?/);

  return (
    <>
      {board ? (
        <GroupBoard groupId={board[1]} page={board[2] ? "answers" : "lobby"} navigate={go} onHome={() => go("/")} />
      ) : join ? (
        <JoinGroup inviteCode={join[1]} onJoined={joined} />
      ) : (
        <CreateGroup onCreated={toGroup} onOpen={toGroup} onJoinCode={(c) => go(`/join/${encodeURIComponent(c)}`)} />
      )}
    </>
  );
}
