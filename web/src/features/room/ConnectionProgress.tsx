import { MicIcon, RadioIcon, UsersIcon } from "../../components/Icons";

const steps = {
  1: { title: "Проверяем комнату…", text: "Убеждаемся, что ссылка ещё действует.", icon: RadioIcon },
  2: { title: "Подключаем звук…", text: "Настраиваем микрофон и динамики.", icon: MicIcon },
  3: { title: "Входим в разговор…", text: "Завершаем подключение.", icon: UsersIcon },
};

export function ConnectionProgress({ step, onCancel }: { step: 1 | 2 | 3; onCancel?: () => void }) {
  const { title, text, icon: Icon } = steps[step];

  return (
    <section className="screen centered-screen" aria-live="polite" aria-busy="true">
      <div className="state-stack">
        <span className="state-icon state-icon--loading state-icon--connection" aria-hidden="true"><Icon /></span>
        <p className="eyebrow">Шаг {step} из 3</p>
        <h1>{title}</h1>
        <p>{text}</p>
        {onCancel && (
          <div className="state-actions">
            <button className="button button--secondary" type="button" onClick={onCancel}>Отменить</button>
          </div>
        )}
      </div>
    </section>
  );
}
