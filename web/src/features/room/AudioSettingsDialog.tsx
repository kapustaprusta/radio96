import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CloseIcon, MicIcon, PlayIcon, StopIcon, VolumeIcon } from "../../components/Icons";
import { playTestTone } from "./audioDeviceTests";
import { AudioTestPanel } from "./AudioTestPanel";
import { DeviceSelect } from "./DeviceSelect";

export interface AudioInputChoice {
  deviceId: string;
  label: string;
}

interface AudioSettingsDialogProps {
  selectedInput: AudioInputChoice;
  selectedOutputId: string;
  microphoneGranted?: boolean;
  onInputChange: (device: AudioInputChoice) => void | Promise<void>;
  onOutputChange: (deviceId: string) => void | Promise<void>;
  onClose: () => void;
}

const defaultInput = { deviceId: "default", label: "Микрофон по умолчанию" };
const defaultOutput = { deviceId: "default", label: "Динамики по умолчанию" };

export function AudioSettingsDialog({
  selectedInput, selectedOutputId, microphoneGranted = false, onInputChange, onOutputChange, onClose,
}: AudioSettingsDialogProps) {
  const [inputs, setInputs] = useState([defaultInput]);
  const [outputs, setOutputs] = useState([defaultOutput]);
  const [granted, setGranted] = useState(microphoneGranted);
  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [speakerTesting, setSpeakerTesting] = useState(false);
  const [outputPending, setOutputPending] = useState(false);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState("");
  const [outputError, setOutputError] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const active = useRef(true);
  const micPending = useRef(false);
  const microphoneTest = useRef<{ stream: MediaStream; context?: AudioContext; timer?: number } | null>(null);
  const speakerTest = useRef<AbortController | null>(null);
  const supportsOutputSelection = "setSinkId" in HTMLMediaElement.prototype;

  const stopMicrophone = useCallback(() => {
    const test = microphoneTest.current;
    microphoneTest.current = null;
    if (!test) return;
    window.clearInterval(test.timer);
    test.stream.getTracks().forEach((track) => track.stop());
    void test.context?.close().catch(() => undefined);
  }, []);

  const updateDevices = useCallback((devices: MediaDeviceInfo[]) => {
    if (!active.current) return;
    setInputs(deviceOptions(devices, "audioinput", defaultInput));
    setOutputs(deviceOptions(devices, "audiooutput", defaultOutput));
    if (devices.some((device) => device.kind === "audioinput" && device.label)) setGranted(true);
  }, []);

  useEffect(() => {
    active.current = true;
    void navigator.mediaDevices?.enumerateDevices().then(updateDevices).catch(() => undefined);
    const update = () => { void navigator.mediaDevices?.enumerateDevices().then(updateDevices).catch(() => undefined); };
    navigator.mediaDevices?.addEventListener?.("devicechange", update);
    let permission: PermissionStatus | undefined;
    const permissionChanged = () => {
      if (active.current && permission) setGranted(permission.state === "granted");
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
  }, [updateDevices, onClose, stopMicrophone]);

  const requestMicrophone = async (test: boolean) => {
    if (micPending.current) return;
    micPending.current = true;
    setPending(true);
    setMicError("");
    stopMicrophone();
    if (test) speakerTest.current?.abort();
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("", "NotFoundError");
      const audio = selectedInput.deviceId === "default" ? true : { deviceId: { exact: selectedInput.deviceId } };
      stream = await navigator.mediaDevices.getUserMedia({ audio });
      if (!active.current) return;
      microphoneTest.current = { stream };
      setGranted(true);
      await navigator.mediaDevices.enumerateDevices().then(updateDevices);
      if (!active.current || !test) return;
      const context = new AudioContext();
      microphoneTest.current = { stream, context };
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      await context.resume();
      if (!active.current || !microphoneTest.current) return;
      const data = new Uint8Array(analyser.fftSize);
      microphoneTest.current.timer = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);
        const power = data.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / data.length;
        setLevel(Math.min(100, Math.sqrt(power) * 400));
      }, 100);
      setTesting(true);
    } catch (error: unknown) {
      stopMicrophone();
      if (active.current) {
        setTesting(false);
        const name = error instanceof DOMException || error instanceof Error ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") setGranted(false);
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
    setTesting(false);
    setLevel(0);
    const controller = new AbortController();
    speakerTest.current = controller;
    setSpeakerTesting(true);
    setOutputError("");
    try { await playTestTone(selectedOutputId, controller.signal); }
    catch { if (active.current && !controller.signal.aborted) setOutputError("Не удалось проверить динамики."); }
    finally {
      if (speakerTest.current === controller) {
        speakerTest.current = null;
        if (active.current) setSpeakerTesting(false);
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
                    if (testing) { stopMicrophone(); setTesting(false); setLevel(0); }
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
                setTesting(false);
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
            ) : <p className="sr-only" role="status">Доступ разрешён</p>}
            {testing && <AudioTestPanel level={level} />}
            {micError && <p className="field-error" role="alert">{micError}</p>}
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
                  setOutputPending(true);
                  try { await onOutputChange(deviceId); }
                  catch { if (active.current) setOutputError("Не удалось выбрать динамики."); }
                  finally { if (active.current) setOutputPending(false); }
                }} />
              {speakerTesting && <AudioTestPanel />}
              {outputError && <p className="field-error" role="alert">{outputError}</p>}
            </section>
          )}
        </div>
        <button className="button button--primary settings-dialog__done" type="button" onClick={onClose}>Готово</button>
      </section>
    </div>, document.body,
  );
}

function deviceOptions(devices: MediaDeviceInfo[], kind: MediaDeviceKind, fallback: AudioInputChoice): AudioInputChoice[] {
  const options = devices.filter((device) => device.kind === kind && device.deviceId !== "default").map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label || `${kind === "audioinput" ? "Микрофон" : "Динамики"} ${index + 1}`,
  }));
  return [fallback, ...options];
}
