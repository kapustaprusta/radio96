const bars = Array.from({ length: 28 }, (_, index) => index);

export function AudioTestPanel({ level }: { level?: number }) {
  const microphone = level !== undefined;
  return (
    <div className="audio-test">
      <div className="audio-test__header" role="status">
        <strong>{microphone ? "Говорите в микрофон" : "Воспроизводим тестовый звук"}</strong>
        <span className="audio-test__status">{microphone ? "Слушаем" : "Играет"}</span>
      </div>
      <div className="audio-test__wave" data-playback={!microphone} role={microphone ? "meter" : "img"}
        aria-label={microphone ? "Уровень микрофона" : "Тестовый звук"}
        aria-valuemin={microphone ? 0 : undefined} aria-valuemax={microphone ? 100 : undefined} aria-valuenow={level}>
        {bars.map((index) => <span key={index} aria-hidden="true" style={{
          height: 5 + (level ?? 60) / 100 * 39 * (0.35 + 0.65 * Math.sin((index + 1) / 29 * Math.PI)),
          animationDelay: `${index * -70}ms`,
        }} />)}
      </div>
    </div>
  );
}
