import { useEffect, useRef, useState } from "react";

import { createRoom } from "../../api/rooms";
import { ClockIcon, PhoneOffIcon, SearchIcon, UnplugIcon, UsersIcon } from "../../components/Icons";
import { sameOriginRoomPath } from "../../routing";

interface RoomErrorProps {
  code: string;
  onRetry: () => void;
  navigate: (path: string) => void;
}

const errorCopy = {
  room_not_found: { title: "Комната не найдена", text: "Проверь ссылку или перейди на главную.", icon: SearchIcon },
  room_expired: { title: "Ссылка больше не действует", text: "В эту комнату никто не вошёл вовремя.", icon: ClockIcon },
  room_finished: {
    title: "Разговор уже закончился", text: "Одноразовую комнату нельзя открыть повторно.", icon: PhoneOffIcon,
  },
  room_closed: { title: "Разговор закончился", text: "Одноразовую комнату нельзя открыть повторно.", icon: PhoneOffIcon },
  room_full: { title: "Комната уже заполнена", text: "Попробуй подключиться немного позже.", icon: UsersIcon },
  media_unavailable: {
    title: "Голосовой сервис временно недоступен", text: "Попробуй подключиться немного позже.", icon: UnplugIcon,
  },
  internal_error: { title: "Что-то пошло не так", text: "Попробуй ещё раз чуть позже.", icon: UnplugIcon },
  connection_failed: { title: "Не удалось подключиться", text: "Проверь интернет и попробуй ещё раз.", icon: UnplugIcon },
  disconnected: { title: "Соединение потеряно", text: "Проверь интернет и попробуй ещё раз.", icon: UnplugIcon },
};

export function RoomError({ code, onRetry, navigate }: RoomErrorProps) {
  const copy = errorCopy[code as keyof typeof errorCopy] ?? {
    title: "Не удалось связаться с radio96", text: "Проверь интернет и попробуй ещё раз.", icon: UnplugIcon,
  };
  const terminal = ["room_not_found", "room_expired", "room_finished", "room_closed"].includes(code);
  const Icon = copy.icon;

  return (
    <section className="screen centered-screen">
      <div className="state-stack" role="alert">
        <span className="state-icon state-icon--danger" aria-hidden="true"><Icon /></span>
        <h1>{copy.title}</h1>
        <p>{copy.text}</p>
        <div className="state-actions">
          {terminal ? <CreateRoomButton navigate={navigate} /> : (
            <button className="button button--primary" type="button" onClick={onRetry}>
              {code === "disconnected" ? "Войти снова" : code === "connection_failed" || code === "room_full"
                ? "Попробовать снова" : "Повторить"}
            </button>
          )}
          <button className="button button--secondary" type="button" onClick={() => navigate("/")}>
            На главную
          </button>
        </div>
      </div>
    </section>
  );
}

export function CreateRoomButton({ navigate }: { navigate: (path: string) => void }) {
  const [state, setState] = useState<"idle" | "creating" | "error">("idle");
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const create = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setState("creating");
    try {
      const response = await createRoom(controller.signal);
      if (controller.signal.aborted) return;
      const path = sameOriginRoomPath(response.inviteUrl, window.location.origin);
      if (!path) throw new Error("Invalid room route");
      navigate(path);
    } catch {
      if (!controller.signal.aborted) setState("error");
    } finally {
      if (request.current === controller) request.current = null;
    }
  };

  return (
    <div className="create-room-control">
      <button className="button button--primary" type="button" disabled={state === "creating"} onClick={create}>
        {state === "creating" ? "Создаём комнату…" : "Создать новую комнату"}
      </button>
      {state === "error" && <p className="field-error" role="alert">Не удалось создать комнату. Попробуй ещё раз.</p>}
    </div>
  );
}
