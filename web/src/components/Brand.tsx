const waveHeights = [8, 13, 20, 12, 23, 16, 9, 18, 11];

export function Brand() {
  return (
    <div className="brand" aria-label="radio96">
      <span className="brand__mark" aria-hidden="true">
        {waveHeights.map((height, index) => (
          <i key={`${height}-${index}`} style={{ height }} />
        ))}
      </span>
      <span className="brand__wordmark">radio96</span>
    </div>
  );
}
