import { MicIcon, MicOffIcon } from "../../components/Icons";

interface MicrophoneAccessProps {
  error?: string;
  pending?: boolean;
  onRetry?: () => void;
  onListen: () => void;
  onCancel?: () => void;
}

export function MicrophoneAccess({ error, pending = false, onRetry, onListen, onCancel }: MicrophoneAccessProps) {
  const missing = error === "microphone_not_found";
  const blocked = error === "microphone_denied";
  const title = pending ? "Подключаем микрофон" : missing ? "Микрофон не найден"
    : blocked ? "Доступ к микрофону заблокирован" : "Не удалось включить микрофон";
  const text = pending ? "Разреши браузеру использовать микрофон или войди без него."
    : missing ? "Подключи микрофон или войди без него, чтобы слушать остальных."
      : blocked ? "Разреши доступ к микрофону в настройках браузера и нажми «Проверить снова»."
        : "Проверь устройство и попробуй снова. В комнату можно войти без микрофона.";

  return (
    <section className="screen centered-screen">
      <div className="prejoin-card">
        <h1>Вход в комнату</h1>
        <p className="prejoin-description">Сначала настроим звук.</p>
        <div className="microphone-notice" role={pending ? "status" : "alert"}>
          <span className="microphone-notice__icon" aria-hidden="true">{pending ? <MicIcon /> : <MicOffIcon />}</span>
          <div><strong>{title}</strong><p>{text}</p></div>
        </div>
        <div className="microphone-notice__actions">
          <button className="button button--primary" type="button" onClick={onRetry} disabled={pending} aria-busy={pending}>
            {pending ? "Подключаем микрофон…" : missing ? "Проверить устройства" : "Проверить снова"}
          </button>
          <button className="button button--secondary" type="button" onClick={onListen}>Войти без микрофона</button>
          {onCancel && <button className="button button--secondary" type="button" onClick={onCancel}>Отменить</button>}
        </div>
      </div>
    </section>
  );
}
