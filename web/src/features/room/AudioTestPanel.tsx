import { idleBars } from "./equalizer";
import type { AudioBar } from "./equalizer";

type TestState = "pending" | "active" | "error";

export function AudioTestPanel({ kind, state, bars = idleBars, error }: {
  kind: "microphone" | "speaker";
  state: TestState;
  bars?: readonly AudioBar[];
  error?: string;
}) {
  const microphone = kind === "microphone";
  const title = state === "error" ? microphone ? "Не удалось включить микрофон" : error ?? "Не удалось воспроизвести тестовый звук"
    : state === "pending" ? microphone ? "Подключаем микрофон…" : "Запускаем тестовый звук…"
      : microphone ? "Скажи что-нибудь" : "Играет тестовый звук";
  const status = state === "error" ? "Ошибка" : state === "pending" ? "Подожди"
    : microphone ? "Проверяем" : "Играет";
  const level = Math.round(Math.max(...bars.map((bar) => bar.height - 4), 0) / 32 * 100);
  return (
    <div className="audio-test" data-state={state}>
      <div className="audio-test__header" role={state === "error" ? "alert" : "status"}>
        <strong>{title}</strong>
        <span className="audio-test__status">{status}</span>
      </div>
      <div className="audio-test__wave" role={microphone ? "meter" : "img"}
        aria-label={microphone ? "Уровень микрофона" : "Тестовый звук"}
        aria-valuemin={microphone ? 0 : undefined} aria-valuemax={microphone ? 100 : undefined}
        aria-valuenow={microphone ? level : undefined}>
        {bars.map((bar, index) => <span key={index} aria-hidden="true" style={{ height: bar.height, opacity: bar.opacity }} />)}
      </div>
    </div>
  );
}
