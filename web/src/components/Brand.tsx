const waveHeights = [4, 13, 8, 20, 11, 6, 18, 9, 3];

export function Brand({ navigate }: { navigate: (path: string) => void }) {
  return (
    <a
      className="brand"
      href="/"
      aria-label="radio96 — на главную"
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        event.preventDefault();
        navigate("/");
      }}
    >
      <span className="brand__mark" aria-hidden="true">
        {waveHeights.map((height, index) => (
          <i key={`${height}-${index}`} style={{ height }} />
        ))}
      </span>
      <span className="brand__wordmark">radio96</span>
    </a>
  );
}
