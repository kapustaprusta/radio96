import { useEffect, useState } from "react";

import { ApiError, getRoom } from "../../api/rooms";
import { ClockIcon, PhoneOffIcon, RadioIcon, SearchIcon, UnplugIcon, UsersIcon } from "../../components/Icons";
import type { ReactNode } from "react";
import { PreJoin } from "./PreJoin";

interface RoomGateProps {
  inviteCode: string;
  navigate: (path: string) => void;
}

type TerminalKind = "not-found" | "expired" | "finished" | "full";

type GateState =
  | { kind: "loading" }
  | { kind: "prejoin" }
  | { kind: "terminal"; terminal: TerminalKind }
  | { kind: "error"; code: string };

const terminalCopy: Record<TerminalKind, { title: string; text: string }> = {
  "not-found": {
    title: "Комната не найдена",
    text: "Проверь ссылку или перейди на главную.",
  },
  expired: {
    title: "Ссылка больше не действует",
    text: "В эту комнату никто не вошёл вовремя.",
  },
  finished: {
    title: "Разговор уже закончился",
    text: "Одноразовую комнату нельзя открыть повторно.",
  },
  full: {
    title: "Комната уже заполнена",
    text: "Попробуй подключиться немного позже.",
  },
};

export function RoomGate({ inviteCode, navigate }: RoomGateProps) {
  const [state, setState] = useState<GateState>({ kind: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    void getRoom(inviteCode, controller.signal)
      .then((room) => {
        if (room.status === "open" || room.status === "active") {
          setState({ kind: "prejoin" });
          return;
        }

        setState({
          kind: "terminal",
          terminal: room.status === "expired" ? "expired" : "finished",
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const terminal = terminalFromError(error);
        if (terminal) {
          setState({ kind: "terminal", terminal });
          return;
        }

        setState({ kind: "error", code: error instanceof ApiError ? error.code : "network_error" });
      });

    return () => controller.abort();
  }, [inviteCode, requestVersion]);

  const retry = () => {
    setState({ kind: "loading" });
    setRequestVersion((value) => value + 1);
  };

  if (state.kind === "loading") {
    return <LoadingState />;
  }

  if (state.kind === "prejoin") {
    return <PreJoin />;
  }

  if (state.kind === "terminal") {
    return (
      <TerminalState
        terminal={state.terminal}
        onPrimary={state.terminal === "full" ? retry : () => navigate("/")}
        onSecondary={state.terminal === "full" ? () => navigate("/") : undefined}
      />
    );
  }

  return <RecoverableError code={state.code} onRetry={retry} onHome={() => navigate("/")} />;
}

function LoadingState() {
  return (
    <section className="screen centered-screen" aria-live="polite" aria-busy="true">
      <div className="state-stack">
        <span className="state-icon state-icon--loading" aria-hidden="true">
          <RadioIcon />
        </span>
        <p className="eyebrow">Шаг 1 из 3</p>
        <h1>Проверяем комнату…</h1>
        <p>Убеждаемся, что ссылка ещё действует.</p>
      </div>
    </section>
  );
}

interface TerminalStateProps {
  terminal: TerminalKind;
  onPrimary: () => void;
  onSecondary?: () => void;
}

function TerminalState({ terminal, onPrimary, onSecondary }: TerminalStateProps) {
  const copy = terminalCopy[terminal];
  const icon = terminalIcon(terminal);

  return (
    <section className="screen centered-screen">
      <div className="state-stack">
        <span className="state-icon" aria-hidden="true">
          {icon}
        </span>
        <h1>{copy.title}</h1>
        <p>{copy.text}</p>
        <div className="state-actions">
          <button className="button button--primary" type="button" onClick={onPrimary}>
            {terminal === "full" ? "Попробовать снова" : "На главную"}
          </button>
          {onSecondary && (
            <button className="button button--secondary" type="button" onClick={onSecondary}>
              На главную
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function RecoverableError({ code, onRetry, onHome }: { code: string; onRetry: () => void; onHome: () => void }) {
  const title =
    code === "media_unavailable"
      ? "Голосовой сервис временно недоступен"
      : code === "internal_error"
        ? "Что-то пошло не так"
        : "Не удалось связаться с radio96";

  return (
    <section className="screen centered-screen">
      <div className="state-stack" role="alert">
        <span className="state-icon state-icon--danger" aria-hidden="true">
          <UnplugIcon />
        </span>
        <h1>{title}</h1>
        <p>Проверь интернет и попробуй ещё раз.</p>
        <div className="state-actions">
          <button className="button button--primary" type="button" onClick={onRetry}>
            Повторить
          </button>
          <button className="button button--secondary" type="button" onClick={onHome}>
            На главную
          </button>
        </div>
      </div>
    </section>
  );
}

function terminalFromError(error: unknown): TerminalKind | null {
  if (!(error instanceof ApiError)) {
    return null;
  }

  const byCode: Record<string, TerminalKind> = {
    room_not_found: "not-found",
    room_expired: "expired",
    room_finished: "finished",
    room_full: "full",
  };

  return byCode[error.code] ?? (error.status === 404 ? "not-found" : null);
}

function terminalIcon(terminal: TerminalKind): ReactNode {
  if (terminal === "not-found") {
    return <SearchIcon />;
  }

  if (terminal === "expired") {
    return <ClockIcon />;
  }

  if (terminal === "finished") {
    return <PhoneOffIcon />;
  }

  return <UsersIcon />;
}
