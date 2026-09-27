export interface AudioBar {
  height: number;
  opacity: number;
}

export const equalizerBarCount = 28;
export const idleBars: AudioBar[] = Array.from({ length: equalizerBarCount }, () => ({ height: 4, opacity: 0.42 }));

export function sampleEqualizer(analyser: AnalyserNode, spectrum: Uint8Array<ArrayBuffer>, previous: readonly AudioBar[]): AudioBar[] {
  analyser.getByteFrequencyData(spectrum);
  const binHz = analyser.context.sampleRate / analyser.fftSize;
  const firstBin = Math.max(1, Math.floor(70 / binHz));
  const lastBin = Math.min(spectrum.length - 1, Math.ceil(10000 / binHz));
  const range = lastBin / firstBin;

  return Array.from({ length: equalizerBarCount }, (_, index) => {
    const start = Math.max(firstBin, Math.floor(firstBin * range ** (index / equalizerBarCount)));
    const end = Math.max(start + 1, Math.floor(firstBin * range ** ((index + 1) / equalizerBarCount)));
    let peak = 0;
    for (let bin = start; bin < Math.min(end, spectrum.length); bin += 1) {
      peak = Math.max(peak, spectrum[bin]);
    }
    const level = Math.min(1, (peak / 255) ** 0.72);
    const targetHeight = 4 + level * 32;
    const currentHeight = previous[index]?.height ?? 4;
    const response = targetHeight > currentHeight ? 0.62 : 0.18;
    return {
      height: Math.round(currentHeight + (targetHeight - currentHeight) * response),
      opacity: Number((0.42 + level * 0.58).toFixed(2)),
    };
  });
}
