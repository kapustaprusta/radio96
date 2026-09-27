import { idleBars, sampleEqualizer } from "./equalizer";
import type { AudioBar } from "./equalizer";

export async function playTestTone(
  deviceId: string,
  signal: AbortSignal,
  onBars?: (bars: AudioBar[]) => void,
): Promise<void> {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const analyser = context.createAnalyser();
  const destination = context.createMediaStreamDestination();
  const audio = new Audio();
  const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  let interval: number | undefined;
  let frame: number | undefined;
  let started = false;
  let finished = false;
  let finish: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => { finish = resolve; });
  const stop = () => {
    if (finished) return;
    finished = true;
    window.clearInterval(interval);
    window.cancelAnimationFrame(frame ?? 0);
    audio.pause();
    audio.srcObject = null;
    if (started) oscillator.stop();
    destination.stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => undefined);
    finish();
  };
  signal.addEventListener("abort", stop, { once: true });

  try {
    if (signal.aborted) return;
    oscillator.type = "triangle";
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.76;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -20;
    gain.gain.value = 0.0001;
    oscillator.connect(gain).connect(analyser).connect(destination);
    audio.srcObject = destination.stream;
    if (sinkAudio.setSinkId) await sinkAudio.setSinkId(deviceId);
    if (signal.aborted) return;
    await context.resume();
    if (signal.aborted) return;
    await audio.play();
    if (signal.aborted) return;
    oscillator.start();
    started = true;

    const notes = [261.63, 329.63, 392, 523.25, 392, 329.63, null, null];
    let noteIndex = 0;
    const playNote = () => {
      const frequency = notes[noteIndex];
      noteIndex = (noteIndex + 1) % notes.length;
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0.0001, now);
      if (frequency === null) return;
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    };
    playNote();
    interval = window.setInterval(playNote, 460);

    if (onBars) {
      const spectrum = new Uint8Array(analyser.frequencyBinCount);
      let previous = idleBars;
      const draw = () => {
        if (signal.aborted) return;
        previous = sampleEqualizer(analyser, spectrum, previous);
        onBars(previous);
        frame = window.requestAnimationFrame(draw);
      };
      draw();
    }

    await stopped;
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
  }
}
