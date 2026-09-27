import { describe, expect, it, vi } from "vitest";

import { equalizerBarCount, idleBars, sampleEqualizer } from "./equalizer";

describe("frequency equalizer", () => {
  it("maps measured spectrum to 28 independently sized and faded bars", () => {
    const measured = new Uint8Array(1024);
    measured[50] = 255;
    const analyser = { fftSize: 2048, context: { sampleRate: 48000 },
      getByteFrequencyData: vi.fn((spectrum: Uint8Array) => spectrum.set(measured)) } as unknown as AnalyserNode;
    const spectrum = new Uint8Array(1024);

    const active = sampleEqualizer(analyser, spectrum, idleBars);
    expect(analyser.getByteFrequencyData).toHaveBeenCalledWith(spectrum);
    expect(active).toHaveLength(equalizerBarCount);
    expect(active.some((bar) => bar.height > 4 && bar.opacity > 0.42)).toBe(true);
    expect(active.some((bar) => bar.height === 4 && bar.opacity === 0.42)).toBe(true);

    measured.fill(0);
    const releasing = sampleEqualizer(analyser, spectrum, active);
    const loudest = active.reduce((index, bar, next) => bar.height > active[index].height ? next : index, 0);
    expect(releasing[loudest].height).toBeLessThan(active[loudest].height);
    expect(releasing[loudest].height).toBeGreaterThan(4);
    expect(idleBars.every((bar) => bar.height === 4 && bar.opacity === 0.42)).toBe(true);
  });
});
