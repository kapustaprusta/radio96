const waveHeights = [4, 13, 8, 20, 11, 6, 18, 9, 3];

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
