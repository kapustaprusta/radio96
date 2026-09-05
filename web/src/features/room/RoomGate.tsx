import { useEffect, useState } from "react";

import { ApiError, getRoom } from "../../api/rooms";
import { ConnectionProgress } from "./ConnectionProgress";
import { RoomError } from "./RoomError";
import { RoomSession } from "./RoomSession";

interface RoomGateProps {
  inviteCode: string;
  navigate: (path: string) => void;
}

type GateState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; code: string };

export function RoomGate({ inviteCode, navigate }: RoomGateProps) {
  const [state, setState] = useState<GateState>({ kind: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
      setState({ kind: "error", code: "network_error" });
    }, 15000);

    void getRoom(inviteCode, controller.signal)
      .then((room) => {
        if (controller.signal.aborted) return;
        setState(room.status === "open" || room.status === "active"
          ? { kind: "ready" } : { kind: "error", code: `room_${room.status}` });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ kind: "error", code: error instanceof ApiError ? error.code : "network_error" });
        }
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [inviteCode, requestVersion]);

  if (state.kind === "loading") return <ConnectionProgress step={1} />;
  if (state.kind === "ready") return <RoomSession inviteCode={inviteCode} navigate={navigate} />;

  return (
    <RoomError
      code={state.code}
      navigate={navigate}
      onRetry={() => {
        setState({ kind: "loading" });
        setRequestVersion((value) => value + 1);
      }}
    />
  );
}
