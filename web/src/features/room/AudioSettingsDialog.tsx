import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CloseIcon, MicIcon, PlayIcon, StopIcon, VolumeIcon } from "../../components/Icons";
import { playTestTone } from "./audioDeviceTests";
import { AudioTestPanel } from "./AudioTestPanel";
import { DeviceSelect } from "./DeviceSelect";
import { idleBars, sampleEqualizer } from "./equalizer";
import type { AudioBar } from "./equalizer";

export interface AudioInputChoice {
  deviceId: string;
  label: string;
}

interface AudioSettingsDialogProps {
  selectedInput: AudioInputChoice;
  selectedOutputId: string;
  microphoneGranted?: boolean;
  onMicrophonePermissionChange?: (state: PermissionState, announce?: boolean) => void;
  onInputChange: (device: AudioInputChoice) => void | Promise<void>;
  onOutputChange: (deviceId: string) => void | Promise<void>;
  onClose: () => void;
}

const defaultInput = { deviceId: "default", label: "Микрофон по умолчанию" };
const defaultOutput = { deviceId: "default", label: "Динамики по умолчанию" };

export function AudioSettingsDialog({
  selectedInput, selectedOutputId, microphoneGranted = false, onMicrophonePermissionChange,
  onInputChange, onOutputChange, onClose,
}: AudioSettingsDialogProps) {
  const [inputs, setInputs] = useState([defaultInput]);
  const [outputs, setOutputs] = useState([defaultOutput]);
  const [granted, setGranted] = useState(microphoneGranted);
  const [pending, setPending] = useState(false);
  const [micTestState, setMicTestState] = useState<"idle" | "pending" | "active" | "error">("idle");
  const [speakerTestState, setSpeakerTestState] = useState<"idle" | "pending" | "active" | "error">("idle");
  const [outputPending, setOutputPending] = useState(false);
  const [bars, setBars] = useState<AudioBar[]>(idleBars);
  const [micError, setMicError] = useState("");
  const [outputError, setOutputError] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const active = useRef(true);
  const micPending = useRef(false);
  const microphoneTest = useRef<{ stream: MediaStream; context?: AudioContext; frame?: number } | null>(null);
  const speakerTest = useRef<AbortController | null>(null);
  const supportsOutputSelection = "setSinkId" in HTMLMediaElement.prototype;
  const testing = micTestState === "active";
  const speakerTesting = speakerTestState === "pending" || speakerTestState === "active";

  const stopMicrophone = useCallback(() => {
    const test = microphoneTest.current;
    microphoneTest.current = null;
    if (!test) return;
    window.cancelAnimationFrame(test.frame ?? 0);
    test.stream.getTracks().forEach((track) => track.stop());
    void test.context?.close().catch(() => undefined);
  }, []);

  const updateDevices = useCallback((devices: MediaDeviceInfo[]) => {
    if (!active.current) return;
    setInputs(deviceOptions(devices, "audioinput", defaultInput));
    setOutputs(deviceOptions(devices, "audiooutput", defaultOutput));
    if (devices.some((device) => device.kind === "audioinput" && device.label)) {
      setGranted(true);
      onMicrophonePermissionChange?.("granted");
    }
  }, [onMicrophonePermissionChange]);

  useEffect(() => {
    active.current = true;
    void navigator.mediaDevices?.enumerateDevices().then(updateDevices).catch(() => undefined);
    const update = () => { void navigator.mediaDevices?.enumerateDevices().then(updateDevices).catch(() => undefined); };
    navigator.mediaDevices?.addEventListener?.("devicechange", update);
    let permission: PermissionStatus | undefined;
    let permissionInitialized = false;
    const permissionChanged = () => {
      if (active.current && permission) {
        const allowed = permission.state === "granted";
        setGranted(allowed);
        onMicrophonePermissionChange?.(permission.state, permissionInitialized);
        permissionInitialized = true;
      }
    };
    void navigator.permissions?.query({ name: "microphone" as PermissionName }).then((result) => {
      if (!active.current) return;
      permission = result;
      permissionChanged();
      permission.addEventListener("change", permissionChanged);
    }).catch(() => undefined);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const selector = "button:not(:disabled), select:not(:disabled), input:not(:disabled)";
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(selector) ?? []);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      active.current = false;
      stopMicrophone();
      speakerTest.current?.abort();
      permission?.removeEventListener("change", permissionChanged);
      navigator.mediaDevices?.removeEventListener?.("devicechange", update);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [updateDevices, onClose, onMicrophonePermissionChange, stopMicrophone]);

  const requestMicrophone = async (test: boolean) => {
    if (micPending.current) return;
    micPending.current = true;
    setPending(true);
    setMicError("");
    stopMicrophone();
    if (test) {
      setMicTestState("pending");
      setBars(idleBars);
    }
    if (test) speakerTest.current?.abort();
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("", "NotFoundError");
      const audio = selectedInput.deviceId === "default" ? true : { deviceId: { exact: selectedInput.deviceId } };
      stream = await navigator.mediaDevices.getUserMedia({ audio });
      if (!active.current) return;
      microphoneTest.current = { stream };
      setGranted(true);
      onMicrophonePermissionChange?.("granted", true);
      await navigator.mediaDevices.enumerateDevices().then(updateDevices);
      if (!active.current || !test) return;
      const context = new AudioContext();
      microphoneTest.current = { stream, context };
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.76;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -20;
      context.createMediaStreamSource(stream).connect(analyser);
      await context.resume();
      if (!active.current || !microphoneTest.current) return;
      const spectrum = new Uint8Array(analyser.frequencyBinCount);
      let previous = idleBars;
      const draw = () => {
        const currentTest = microphoneTest.current;
        if (!active.current || !currentTest || currentTest.stream !== stream) return;
        previous = sampleEqualizer(analyser, spectrum, previous);
        setBars(previous);
        currentTest.frame = window.requestAnimationFrame(draw);
      };
      setMicTestState("active");
      draw();
    } catch (error: unknown) {
      stopMicrophone();
      if (active.current) {
        setMicTestState(test ? "error" : "idle");
        const name = error instanceof DOMException || error instanceof Error ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setGranted(false);
          onMicrophonePermissionChange?.("denied", true);
        }
        setMicError(name === "NotFoundError" ? "Микрофон не найден. Подключи устройство."
          : name === "NotAllowedError" || name === "SecurityError"
            ? "Разреши доступ к микрофону в настройках браузера."
            : "Не удалось проверить микрофон. Проверь устройство.");
      }
    } finally {
      if ((!test || !active.current) && microphoneTest.current?.stream === stream) stopMicrophone();
      if (stream && microphoneTest.current?.stream !== stream) stream.getTracks().forEach((track) => track.stop());
      micPending.current = false;
      if (active.current) setPending(false);
    }
  };

  const testSpeakers = async () => {
    if (speakerTest.current) { speakerTest.current.abort(); return; }
    stopMicrophone();
    setMicTestState("idle");
    setBars(idleBars);
    const controller = new AbortController();
    speakerTest.current = controller;
    setSpeakerTestState("pending");
    setOutputError("");
    let failed = false;
    try {
      await playTestTone(selectedOutputId, controller.signal, (nextBars) => {
        if (!active.current || controller.signal.aborted) return;
        setBars(nextBars);
        setSpeakerTestState("active");
      });
    } catch {
      if (active.current && !controller.signal.aborted) {
        failed = true;
        setOutputError("Не удалось воспроизвести тестовый звук.");
        setSpeakerTestState("error");
      }
    }
    finally {
      if (speakerTest.current === controller) {
        speakerTest.current = null;
        if (active.current && !failed) setSpeakerTestState("idle");
      }
    }
  };

  return createPortal(
    <div className="settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialog} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="audio-settings-title">
        <div className="settings-dialog__header">
          <div><h2 id="audio-settings-title">Настройки звука</h2><p>Выбери микрофон и динамики</p></div>
          <button className="button button--icon settings-dialog__close" type="button"
            aria-label="Закрыть настройки" autoFocus onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="device-list">
          <section className="device-panel">
            <div className="device-panel__header">
              <div className="device-panel__title"><span className="device-panel__icon"><MicIcon /></span>Микрофон</div>
              {granted && (
                <button className="button button--secondary device-panel__test" type="button"
                  aria-pressed={testing} disabled={pending} onClick={() => {
                    if (testing) { stopMicrophone(); setMicTestState("idle"); setBars(idleBars); }
                    else void requestMicrophone(true);
                  }}>{testing ? <StopIcon /> : <PlayIcon />}{testing ? "Остановить" : "Проверить"}</button>
              )}
            </div>
            <DeviceSelect id="audio-input" label="Выбрать микрофон" value={selectedInput.deviceId} options={inputs}
              disabledLabel={granted ? undefined : "Нет доступа к микрофону"}
              disabled={!granted || pending} onChange={async (deviceId) => {
                const input = inputs.find((device) => device.deviceId === deviceId) ?? defaultInput;
                setPending(true);
                setMicError("");
                stopMicrophone();
                setMicTestState("idle");
                setBars(idleBars);
                try { await onInputChange(input); }
                catch { if (active.current) setMicError("Не удалось выбрать микрофон."); }
                finally { if (active.current) setPending(false); }
              }} />
            {!granted ? (
              <div className="device-permission">
                <button className="button button--primary" type="button" disabled={pending} onClick={() => requestMicrophone(false)}>
                  {pending ? "Запрашиваем доступ…" : "Разрешить доступ"}
                </button>
              </div>
            ) : <p className="sr-only" role="status">Доступ к микрофону разрешён</p>}
            {micTestState !== "idle" && <AudioTestPanel kind="microphone" state={micTestState} bars={bars} error={micError} />}
            {micError && <p className="field-error" role={micTestState === "error" ? undefined : "alert"}>{micError}</p>}
          </section>
          {supportsOutputSelection && (
            <section className="device-panel">
              <div className="device-panel__header">
                <div className="device-panel__title"><span className="device-panel__icon"><VolumeIcon /></span>Динамики</div>
                <button className="button button--secondary device-panel__test" type="button"
                  aria-pressed={speakerTesting} disabled={pending || outputPending} onClick={testSpeakers}>
                  {speakerTesting ? <StopIcon /> : <PlayIcon />}{speakerTesting ? "Остановить" : "Проверить"}
                </button>
              </div>
              <DeviceSelect id="audio-output" label="Выбрать динамики" value={selectedOutputId} options={outputs}
                disabled={speakerTesting || outputPending} onChange={async (deviceId) => {
                  setOutputError("");
                  setSpeakerTestState("idle");
                  setBars(idleBars);
                  setOutputPending(true);
                  try { await onOutputChange(deviceId); }
                  catch { if (active.current) setOutputError("Не удалось выбрать динамики."); }
                  finally { if (active.current) setOutputPending(false); }
                }} />
              {speakerTestState !== "idle" && <AudioTestPanel kind="speaker" state={speakerTestState}
                bars={bars} error={outputError} />}
              {outputError && speakerTestState !== "error" && <p className="field-error" role="alert">{outputError}</p>}
            </section>
          )}
        </div>
        <button className="button button--primary settings-dialog__done" type="button" onClick={onClose}>Готово</button>
      </section>
    </div>, document.body,
  );
}

function deviceOptions(devices: MediaDeviceInfo[], kind: MediaDeviceKind, fallback: AudioInputChoice): AudioInputChoice[] {
  const defaultDevice = devices.find((device) => device.kind === kind && device.deviceId === "default");
  const options = devices.filter((device) => device.kind === kind && device.deviceId !== "default").map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label || `${kind === "audioinput" ? "Микрофон" : "Динамики"} ${index + 1}`,
  }));
  return [{ ...fallback, label: defaultDevice?.label || fallback.label }, ...options];
}
