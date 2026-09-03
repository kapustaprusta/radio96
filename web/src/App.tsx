import { useCallback, useEffect, useState } from "react";

import { Brand } from "./components/Brand";
import { HomePage } from "./features/home/HomePage";
import { RoomGate } from "./features/room/RoomGate";
import { parseRoute } from "./routing";

export function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const route = parseRoute(pathname);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    document.title = titleForRoute(route.kind);
  }, [route.kind]);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, "", path);
    setPathname(window.location.pathname);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  return (
    <div className="app-frame">
      <header className="app-header">
        <Brand />
      </header>
      <main className="app-main">
        {route.kind === "home" && <HomePage navigate={navigate} />}
        {route.kind === "room" && (
          <RoomGate key={route.inviteCode} inviteCode={route.inviteCode} navigate={navigate} />
        )}
        {route.kind === "not-found" && <NotFound navigate={navigate} />}
      </main>
    </div>
  );
}

function NotFound({ navigate }: { navigate: (path: string) => void }) {
  return (
    <section className="screen centered-screen">
      <div className="state-stack">
        <p className="eyebrow">Ошибка 404</p>
        <h1>Такой страницы нет</h1>
        <p>Вернись на главную и создай голосовую комнату.</p>
        <button className="button button--primary" type="button" onClick={() => navigate("/")}>
          На главную
        </button>
      </div>
    </section>
  );
}

function titleForRoute(kind: ReturnType<typeof parseRoute>["kind"]): string {
  if (kind === "room") {
    return "Голосовая комната — radio96";
  }

  if (kind === "not-found") {
    return "Страница не найдена — radio96";
  }

  return "radio96";
}
