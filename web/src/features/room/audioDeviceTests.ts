export async function playTestTone(deviceId: string, signal: AbortSignal): Promise<void> {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const destination = context.createMediaStreamDestination();
  const audio = new Audio();
  const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  let finish: (() => void) | undefined;
  const stop = () => {
    audio.pause();
    audio.srcObject = null;
    destination.stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => undefined);
    finish?.();
  };
  signal.addEventListener("abort", stop, { once: true });

  try {
    oscillator.frequency.value = 440;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
    oscillator.connect(gain).connect(destination);
    audio.srcObject = destination.stream;
    if (sinkAudio.setSinkId) await sinkAudio.setSinkId(deviceId);
    if (signal.aborted) return;
    await context.resume();
    if (signal.aborted) return;
    await audio.play();
    if (signal.aborted) return;
    oscillator.start();
    oscillator.stop(context.currentTime + 0.34);
    await new Promise<void>((resolve) => {
      finish = resolve;
      oscillator.addEventListener("ended", () => resolve(), { once: true });
    });
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
  }
}
