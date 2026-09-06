import { ClockIcon, PhoneOffIcon, SearchIcon, UnplugIcon, UsersIcon } from "../../components/Icons";

interface RoomErrorProps {
  code: string;
  onRetry: () => void;
  navigate: (path: string) => void;
}

const errorCopy = {
  room_not_found: { title: "Комната не найдена", text: "Проверь ссылку или перейди на главную.", icon: SearchIcon },
  room_expired: { title: "Ссылка больше не действует", text: "В эту комнату никто не вошёл вовремя.", icon: ClockIcon },
  room_finished: {
    title: "Разговор завершён", text: "Комнату нельзя открыть повторно.", icon: PhoneOffIcon,
  },
  room_closed: { title: "Разговор завершён", text: "Комнату нельзя открыть повторно.", icon: PhoneOffIcon },
  room_full: { title: "Комната уже заполнена", text: "Попробуй подключиться немного позже.", icon: UsersIcon },
  media_unavailable: {
    title: "Голосовой сервис временно недоступен", text: "Попробуй подключиться немного позже.", icon: UnplugIcon,
  },
  internal_error: { title: "Что-то пошло не так", text: "Попробуй ещё раз чуть позже.", icon: UnplugIcon },
  connection_failed: { title: "Не удалось подключиться", text: "Проверь интернет и попробуй ещё раз.", icon: UnplugIcon },
  disconnected: { title: "Связь прервалась", text: "Проверь интернет и попробуй подключиться снова.", icon: UnplugIcon },
};

export function RoomError({ code, onRetry, navigate }: RoomErrorProps) {
  const copy = errorCopy[code as keyof typeof errorCopy] ?? {
    title: "Не удалось связаться с radio96", text: "Проверь интернет и попробуй ещё раз.", icon: UnplugIcon,
  };
  const terminal = ["room_not_found", "room_expired", "room_finished", "room_closed"].includes(code);
  const Icon = copy.icon;

  return (
    <section className="screen centered-screen system-screen">
      <div className="state-stack" role="alert">
        <span className="state-icon" aria-hidden="true"><Icon /></span>
        <h1>{copy.title}</h1>
        <p>{copy.text}</p>
        <div className="state-actions">
          {!terminal && (
            <button className="button button--primary" type="button" onClick={onRetry}>
              {code === "disconnected" ? "Подключиться снова" : code === "connection_failed" || code === "room_full"
                ? "Попробовать снова" : "Повторить"}
            </button>
          )}
          <button className={`button button--${terminal ? "primary" : "secondary"}`} type="button" onClick={() => navigate("/")}>
            На главную
          </button>
        </div>
      </div>
    </section>
  );
}
