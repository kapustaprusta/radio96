import { useEffect, useRef, useState } from "react";

import { createRoom } from "../../api/rooms";
import { AlertIcon } from "../../components/Icons";
import { sameOriginRoomPath } from "../../routing";

interface HomePageProps {
  navigate: (path: string) => void;
}

type CreateState = "idle" | "creating" | "error";

export function HomePage({ navigate }: HomePageProps) {
  const [state, setState] = useState<CreateState>("idle");
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
    },
    [],
  );

  const handleCreate = async () => {
    if (activeRequest.current) {
      return;
    }

    const controller = new AbortController();
    activeRequest.current = controller;
    setState("creating");

    try {
      const room = await createRoom(controller.signal);
      const roomPath = sameOriginRoomPath(room.inviteUrl, window.location.origin);

      if (!roomPath) {
        setState("error");
        return;
      }

      navigate(roomPath);
    } catch {
      if (!controller.signal.aborted) {
        setState("error");
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  };

  const isCreating = state === "creating";

  return (
    <section className="screen home-screen">
      <div className="home-copy">
        <h1>Голосовой чат для игры с друзьями</h1>
        <p>Создай комнату до 8 человек и отправь ссылку друзьям.</p>

        <button
          className="button button--primary home-action"
          type="button"
          disabled={isCreating}
          aria-busy={isCreating}
          onClick={handleCreate}
        >
          {isCreating ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Создаём комнату…
            </>
          ) : (
            state === "error" ? "Попробовать снова" : "Создать комнату"
          )}
        </button>

        <div className="home-feedback">
          {state === "error" && (
            <div className="inline-alert" role="alert">
              <AlertIcon />
              <span>Не удалось создать комнату. Попробуй ещё раз.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
