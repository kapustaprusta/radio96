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
  const title = pending ? "Разреши доступ к микрофону" : missing ? "Микрофон не найден"
    : blocked ? "Доступ к микрофону заблокирован" : "Не удалось включить микрофон";
  const text = pending ? "Браузер покажет системный запрос. После разрешения микрофон включится автоматически."
    : missing ? "Подключи микрофон или выбери другое устройство. В комнату всё равно можно войти без микрофона."
      : blocked ? "Разреши микрофон в настройках браузера, затем обнови проверку."
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
            {pending ? "Ожидаем разрешение…" : missing ? "Проверить устройства" : "Проверить снова"}
          </button>
          <button className="button button--secondary" type="button" onClick={onListen}>Войти без микрофона</button>
          {onCancel && <button className="button button--secondary" type="button" onClick={onCancel}>Отменить</button>}
        </div>
      </div>
    </section>
  );
}
