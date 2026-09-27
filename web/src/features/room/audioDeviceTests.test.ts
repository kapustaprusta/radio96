import { afterEach, describe, expect, it, vi } from "vitest";

import { playTestTone } from "./audioDeviceTests";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("speaker test playback", () => {
  it("repeats notes on the chosen output until stopped and frees every resource", async () => {
    vi.useFakeTimers();
    const stopTrack = vi.fn();
    const stopOscillator = vi.fn();
    const frequency = { setValueAtTime: vi.fn() };
    const amplitude = { value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn() };
    const destination = { stream: { getTracks: () => [{ stop: stopTrack }] } };
    const analyser = { context: { sampleRate: 48000 }, fftSize: 2048, frequencyBinCount: 1024,
      getByteFrequencyData: vi.fn((data: Uint8Array) => data.fill(90)), connect: () => destination };
    const gain = { gain: amplitude, connect: () => analyser };
    const oscillator = { frequency, type: "sine", connect: () => gain, start: vi.fn(), stop: stopOscillator };
    const close = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("AudioContext", class {
      currentTime = 0;
      createOscillator = () => oscillator;
      createGain = () => gain;
      createAnalyser = () => analyser;
      createMediaStreamDestination = () => destination;
      resume = vi.fn().mockResolvedValue(undefined);
      close = close;
    });
    const pause = vi.fn();
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("Audio", class {
      srcObject: MediaStream | null = null;
      pause = pause;
      play = vi.fn().mockResolvedValue(undefined);
      setSinkId = setSinkId;
    });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    const controller = new AbortController();
    const onBars = vi.fn();
    const playback = playTestTone("speakers", controller.signal, onBars);
    for (let step = 0; step < 5; step += 1) await Promise.resolve();
    expect(setSinkId).toHaveBeenCalledWith("speakers");
    expect(oscillator.start).toHaveBeenCalledOnce();
    expect(onBars).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(920);
    expect(frequency.setValueAtTime.mock.calls.length).toBeGreaterThan(1);

    controller.abort();
    await playback;
    expect(stopOscillator).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });
});
