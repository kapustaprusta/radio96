import { RadioIcon } from "../../components/Icons";

export function ConnectionProgress({ checkingRoom = false, onCancel }: { checkingRoom?: boolean; onCancel?: () => void }) {
  return (
    <section className="screen centered-screen" aria-live="polite" aria-busy="true">
      <div className="connection-stack">
        <span className="state-icon state-icon--loading" aria-hidden="true"><RadioIcon /></span>
        <h1>{checkingRoom ? "Проверяем комнату…" : "Подключаемся…"}</h1>
        {onCancel && (
          <div className="state-actions">
            <button className="button button--secondary" type="button" onClick={onCancel}>Отменить</button>
          </div>
        )}
      </div>
    </section>
  );
}
