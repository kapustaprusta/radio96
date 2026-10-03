import { LogOutIcon } from "../../components/Icons";

export function RoomLeft({ onRejoin, onHome }: { onRejoin: () => void; onHome: () => void }) {
  return (
    <section className="screen centered-screen system-screen">
      <div className="state-stack">
        <span className="state-icon" aria-hidden="true"><LogOutIcon /></span>
        <h1>Ты вышел из разговора</h1>
        <p>После выхода последнего участника ссылка будет работать ещё 10 минут. Ты сможешь вернуться по ней.</p>
        <div className="state-actions">
          <button className="button button--primary" type="button" onClick={onRejoin}>Вернуться в разговор</button>
          <button className="button button--secondary" type="button" onClick={onHome}>На главную</button>
        </div>
      </div>
    </section>
  );
}
