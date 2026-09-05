import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, getRoom, joinRoom } from "../../api/rooms";
import { PhoneOffIcon } from "../../components/Icons";
import { createMediaSession } from "../../media/livekit";
import { MediaError } from "../../media/session";
import type { CallSnapshot, MediaSession } from "../../media/session";
import { CallView } from "./CallView";
import { ConnectionProgress } from "./ConnectionProgress";
import { defaultJoinPreferences } from "./joinPreferences";
import type { JoinPreferences } from "./joinPreferences";
import { PreJoin } from "./PreJoin";
import { CreateRoomButton, RoomError } from "./RoomError";

type View =
  | { kind: "prejoin"; microphoneError?: string; nameRejected?: boolean }
  | { kind: "progress"; step: 1 | 2 | 3 }
  | { kind: "call"; snapshot: CallSnapshot; session: MediaSession; startedAt: number; restoredAt?: number }
  | { kind: "left" }
  | { kind: "error"; code: string };

interface Attempt {
  controller: AbortController;
  session: MediaSession;
  unsubscribe?: () => void;
  timer?: number;
  startedAt?: number;
  restoredAt?: number;
  reconnecting?: boolean;
}

export function RoomSession({ inviteCode, navigate }: { inviteCode: string; navigate: (path: string) => void }) {
  const [view, setView] = useState<View>({ kind: "prejoin" });
  const [preferences, setPreferences] = useState(defaultJoinPreferences);
  const attempt = useRef<Attempt | null>(null);

  const dispose = useCallback(() => {
    const current = attempt.current;
    attempt.current = null;
    if (!current) return;
    window.clearTimeout(current.timer);
    current.controller.abort();
    current.unsubscribe?.();
    void current.session.disconnect().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onPageHide = () => { dispose(); setView({ kind: "prejoin" }); };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      dispose();
    };
  }, [dispose]);

  const begin = async (nextPreferences: JoinPreferences) => {
    if (attempt.current) return;
    setPreferences(nextPreferences);
    setView({ kind: "progress", step: 1 });

    let current: Attempt;
    try {
      current = { controller: new AbortController(), session: createMediaSession() };
    } catch {
      setView({ kind: "error", code: "connection_failed" });
      return;
    }
    attempt.current = current;
    const active = () => attempt.current === current && !current.controller.signal.aborted;
    const timeout = () => {
      window.clearTimeout(current.timer);
      current.timer = window.setTimeout(() => {
        if (!active()) return;
        dispose();
        setView({ kind: "error", code: "connection_failed" });
      }, 15000);
    };

    try {
      timeout();
      const room = await getRoom(inviteCode, current.controller.signal);
      if (!active()) return;
      if (room.status === "expired" || room.status === "finished") {
        throw new ApiError(`room_${room.status}`, 410);
      }

      window.clearTimeout(current.timer);
      setView({ kind: "progress", step: 2 });
      if (nextPreferences.microphoneEnabled) {
        await current.session.prepareMicrophone(nextPreferences.input.deviceId);
      }
      if (!active()) return;

      setView({ kind: "progress", step: 3 });
      timeout();
      const credentials = await joinRoom(inviteCode, nextPreferences.displayName, current.controller.signal);
      if (!active()) return;
      await current.session.setOutputDevice(nextPreferences.outputId);
      if (!active()) return;

      current.unsubscribe = current.session.subscribe(() => {
        if (!active() || current.startedAt === undefined) return;
        const snapshot = current.session.getSnapshot();
        if (snapshot.connection === "disconnected") {
          dispose();
          setView({ kind: "error", code: snapshot.disconnectReason === "finished" ? "room_closed" : "disconnected" });
        } else {
          if (snapshot.connection === "connected" && current.reconnecting) current.restoredAt = Date.now();
          current.reconnecting = snapshot.connection === "reconnecting";
          setView({
            kind: "call", snapshot, session: current.session, startedAt: current.startedAt, restoredAt: current.restoredAt,
          });
        }
      });
      timeout();
      await current.session.connect(credentials);
      if (!active()) return;
      window.clearTimeout(current.timer);
      current.startedAt = Date.now();
      const snapshot = current.session.getSnapshot();
      if (snapshot.connection === "disconnected") throw new MediaError("connection_failed");
      setView({ kind: "call", snapshot, session: current.session, startedAt: current.startedAt });
    } catch (error: unknown) {
      if (!active()) return;
      dispose();
      const code = error instanceof ApiError || error instanceof MediaError ? error.code : "connection_failed";
      if (code.startsWith("microphone_")) {
        setView({ kind: "prejoin", microphoneError: code });
      } else if (code === "invalid_name") {
        setView({ kind: "prejoin", nameRejected: true });
      } else {
        setView({ kind: "error", code });
      }
    }
  };

  if (view.kind === "prejoin") {
    return <PreJoin initialPreferences={preferences} onJoin={begin} {...view} />;
  }

  if (view.kind === "progress") {
    return <ConnectionProgress step={view.step} onCancel={() => { dispose(); setView({ kind: "prejoin" }); }} />;
  }

  if (view.kind === "call") {
    return (
      <CallView
        snapshot={view.snapshot}
        startedAt={view.startedAt}
        restoredAt={view.restoredAt}
        session={view.session}
        preferences={preferences}
        onPreferencesChange={setPreferences}
        onLeave={() => { dispose(); setView({ kind: "left" }); }}
      />
    );
  }

  if (view.kind === "left") {
    return (
      <section className="screen centered-screen">
        <div className="state-stack">
          <span className="state-icon state-icon--ended" aria-hidden="true"><PhoneOffIcon /></span>
          <h1>Ты вышел из разговора</h1>
          <p>Можно войти снова, пока комната остаётся активной.</p>
          <div className="state-actions">
            <button className="button button--secondary" type="button" onClick={() => begin(preferences)}>Войти снова</button>
            <CreateRoomButton navigate={navigate} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <RoomError
      code={view.kind === "error" ? view.code : "disconnected"}
      onRetry={() => begin(preferences)}
      navigate={navigate}
    />
  );
}
