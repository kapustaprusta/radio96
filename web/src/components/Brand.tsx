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
      <svg className="brand__mark" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <rect className="brand__mark-background" width="28" height="28" rx="8" />
        <g className="brand__mark-waveform">
          <rect x="3.25" y="12" width="1.5" height="4" rx="0.75" />
          <rect x="5.75" y="7.5" width="1.5" height="13" rx="0.75" />
          <rect x="8.25" y="10" width="1.5" height="8" rx="0.75" />
          <rect x="10.75" y="4" width="1.5" height="20" rx="0.75" />
          <rect x="13.25" y="8.5" width="1.5" height="11" rx="0.75" />
          <rect x="15.75" y="11" width="1.5" height="6" rx="0.75" />
          <rect x="18.25" y="5" width="1.5" height="18" rx="0.75" />
          <rect x="20.75" y="9.5" width="1.5" height="9" rx="0.75" />
          <rect x="23.25" y="12.5" width="1.5" height="3" rx="0.75" />
        </g>
      </svg>
      <span className="brand__wordmark">radio96</span>
    </a>
  );
}
