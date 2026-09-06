import { LogOutIcon } from "../../components/Icons";

export function RoomLeft({ onRejoin, onHome }: { onRejoin: () => void; onHome: () => void }) {
  return (
    <section className="screen centered-screen system-screen">
      <div className="state-stack">
        <span className="state-icon" aria-hidden="true"><LogOutIcon /></span>
        <h1>Ты вышел из разговора</h1>
        <p>Можешь подключиться снова, пока в комнате остаются другие участники.</p>
        <div className="state-actions">
          <button className="button button--primary" type="button" onClick={onRejoin}>Подключиться снова</button>
          <button className="button button--secondary" type="button" onClick={onHome}>На главную</button>
        </div>
      </div>
    </section>
  );
}
