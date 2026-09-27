// src/App.tsx: simple routing without a router dependency
// Language control lives in QuorumHeader (CreateGroup / GroupBoard) — no floating LanguageSwitcher.
import { useCallback, useEffect, useState } from "react";
import { CreateGroup } from "./components/CreateGroup";
import { JoinGroup } from "./components/JoinGroup";
import { GroupBoard } from "./components/GroupBoard";

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  const go = useCallback((p: string) => {
    window.history.pushState({}, "", p);
    setPath(p);
  }, []);

  const toGroup = useCallback((id: string) => go(`/g/${id}`), [go]);

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const join = path.match(/^\/join\/([\w-]+)/);
  const board = path.match(/^\/g\/([\w-]+)/);

  return (
    <>
      {board ? (
        <GroupBoard groupId={board[1]} onHome={() => go("/")} />
      ) : join ? (
        <JoinGroup inviteCode={join[1]} onJoined={toGroup} />
      ) : (
        <CreateGroup onCreated={toGroup} onOpen={toGroup} onJoinCode={(c) => go(`/join/${encodeURIComponent(c)}`)} />
      )}
    </>
  );
}
