import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { CloseIcon, MicIcon, PlayIcon, VolumeIcon } from "../../components/Icons";

export interface AudioInputChoice {
  deviceId: string;
  label: string;
}

interface AudioSettingsDialogProps {
  selectedInput: AudioInputChoice;
  onInputChange: (device: AudioInputChoice) => void;
  onClose: () => void;
}

interface DeviceOption {
  deviceId: string;
  label: string;
}

type TestState = "idle" | "checking" | "ready" | "error";

const defaultInput: DeviceOption = {
  deviceId: "default",
  label: "Микрофон по умолчанию",
};

const defaultOutput: DeviceOption = {
  deviceId: "default",
  label: "Динамики по умолчанию",
};

export function AudioSettingsDialog({ selectedInput, onInputChange, onClose }: AudioSettingsDialogProps) {
  const [inputDevices, setInputDevices] = useState<DeviceOption[]>([defaultInput]);
  const [outputDevices, setOutputDevices] = useState<DeviceOption[]>([defaultOutput]);
  const [selectedInputId, setSelectedInputId] = useState(selectedInput.deviceId);
  const [selectedOutputId, setSelectedOutputId] = useState("default");
  const [micTestState, setMicTestState] = useState<TestState>("idle");
  const [speakerTestState, setSpeakerTestState] = useState<TestState>("idle");
  const dialog = useRef<HTMLElement>(null);
  const supportsOutputSelection =
    typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

  const loadDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    setInputDevices(optionsForKind(devices, "audioinput", defaultInput));
    setOutputDevices(optionsForKind(devices, "audiooutput", defaultOutput));
  }, []);

  useEffect(() => {
    let active = true;

    if (navigator.mediaDevices?.enumerateDevices) {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (!active) {
            return;
          }

          setInputDevices(optionsForKind(devices, "audioinput", defaultInput));
          setOutputDevices(optionsForKind(devices, "audiooutput", defaultOutput));
        })
        .catch(() => {
          if (active) {
            setMicTestState("error");
          }
        });
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableSelector = "button:not(:disabled), select:not(:disabled), input:not(:disabled)";
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      active = false;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const testMicrophone = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicTestState("error");
      return;
    }

    setMicTestState("checking");

    try {
      const audio = selectedInputId === "default" ? true : { deviceId: { exact: selectedInputId } };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      stream.getTracks().forEach((track) => track.stop());
      await loadDevices();
      setMicTestState("ready");
    } catch {
      setMicTestState("error");
    }
  };

  const testSpeakers = async () => {
    setSpeakerTestState("checking");

    try {
      await playTestTone(selectedOutputId);
      setSpeakerTestState("ready");
    } catch {
      setSpeakerTestState("error");
    }
  };

  return (
    <div
      className="settings-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={dialog}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audio-settings-title"
      >
        <div className="settings-dialog__header">
          <div>
            <h2 id="audio-settings-title">Настройки звука</h2>
            <p>Выбери микрофон и динамики</p>
          </div>
          <button
            className="button button--icon settings-dialog__close"
            type="button"
            aria-label="Закрыть настройки"
            autoFocus
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="device-list">
          <DevicePanel
            icon={<MicIcon />}
            title="Микрофон"
            testState={micTestState}
            onTest={testMicrophone}
          >
            <label className="sr-only" htmlFor="audio-input">
              Выбрать микрофон
            </label>
            <select
              className="device-select"
              id="audio-input"
              value={selectedInputId}
              onChange={(event) => {
                const deviceId = event.target.value;
                const device = inputDevices.find((item) => item.deviceId === deviceId) ?? defaultInput;
                setSelectedInputId(deviceId);
                onInputChange(device);
              }}
            >
              {inputDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </DevicePanel>

          {supportsOutputSelection && (
            <DevicePanel
              icon={<VolumeIcon />}
              title="Динамики"
              testState={speakerTestState}
              onTest={testSpeakers}
            >
              <label className="sr-only" htmlFor="audio-output">
                Выбрать динамики
              </label>
              <select
                className="device-select"
                id="audio-output"
                value={selectedOutputId}
                onChange={(event) => setSelectedOutputId(event.target.value)}
              >
                {outputDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </DevicePanel>
          )}
        </div>

        <button className="button button--primary settings-dialog__done" type="button" onClick={onClose}>
          Готово
        </button>
      </section>
    </div>
  );
}

interface DevicePanelProps {
  icon: ReactNode;
  title: string;
  testState: TestState;
  onTest: () => void;
  children: ReactNode;
}

function DevicePanel({ icon, title, testState, onTest, children }: DevicePanelProps) {
  const statusText = {
    idle: "",
    checking: "Проверяем…",
    ready: "Устройство готово",
    error: "Не удалось проверить устройство",
  }[testState];

  return (
    <section className="device-panel">
      <div className="device-panel__header">
        <div className="device-panel__title">
          <span className="device-panel__icon" aria-hidden="true">
            {icon}
          </span>
          <span>{title}</span>
        </div>
        <button
          className="button button--secondary device-panel__test"
          type="button"
          disabled={testState === "checking"}
          onClick={onTest}
        >
          <PlayIcon />
          {testState === "checking" ? "Проверяем…" : "Проверить"}
        </button>
      </div>
      {children}
      {statusText && (
        <div className="device-panel__status" data-state={testState} aria-live="polite">
          {statusText}
        </div>
      )}
    </section>
  );
}

function optionsForKind(devices: MediaDeviceInfo[], kind: MediaDeviceKind, fallback: DeviceOption): DeviceOption[] {
  const options = devices
    .filter((device) => device.kind === kind)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || fallbackLabel(kind, index),
    }));

  return options.length > 0 ? options : [fallback];
}

function fallbackLabel(kind: MediaDeviceKind, index: number): string {
  return kind === "audioinput" ? `Микрофон ${index + 1}` : `Динамики ${index + 1}`;
}

async function playTestTone(deviceId: string): Promise<void> {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const destination = context.createMediaStreamDestination();
  const audio = new Audio();
  const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

  try {
    oscillator.frequency.value = 440;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
    oscillator.connect(gain).connect(destination);
    audio.srcObject = destination.stream;

    if (deviceId !== "default" && sinkAudio.setSinkId) {
      await sinkAudio.setSinkId(deviceId);
    }

    await audio.play();
    oscillator.start();
    oscillator.stop(context.currentTime + 0.34);
    await new Promise<void>((resolve) => oscillator.addEventListener("ended", () => resolve(), { once: true }));
  } finally {
    audio.pause();
    destination.stream.getTracks().forEach((track) => track.stop());
    await context.close();
  }
}
