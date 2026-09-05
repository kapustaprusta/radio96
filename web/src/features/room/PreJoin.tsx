import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { CheckIcon, LinkIcon, MicIcon, MicOffIcon, SettingsIcon } from "../../components/Icons";
import { validateDisplayName } from "../../displayName";
import type { DisplayNameError } from "../../displayName";
import { AudioSettingsDialog } from "./AudioSettingsDialog";
import type { AudioInputChoice } from "./AudioSettingsDialog";

const errorMessages: Record<DisplayNameError, string> = {
  empty: "Введи никнейм",
  "too-long": "Не больше 32 символов",
};

type CopyState = "idle" | "copied" | "fallback";

export function PreJoin() {
  const [displayName, setDisplayName] = useState("");
  const [nameError, setNameError] = useState<DisplayNameError | null>(null);
  const [nameWasChecked, setNameWasChecked] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [selectedInput, setSelectedInput] = useState<AudioInputChoice>({
    deviceId: "default",
    label: "Микрофон по умолчанию",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const fallbackInput = useRef<HTMLInputElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) {
        window.clearTimeout(toastTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (copyState === "fallback") {
      fallbackInput.current?.select();
    }
  }, [copyState]);

  const checkName = (): boolean => {
    const result = validateDisplayName(displayName);
    setNameWasChecked(true);

    if (!result.valid) {
      setNameError(result.error);
      return false;
    }

    setDisplayName(result.value);
    setNameError(null);
    return true;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    checkName();
  };

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsButton.current?.focus());
  }, []);

  const handleCopy = async () => {
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }

      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
      toastTimer.current = window.setTimeout(() => {
        setCopyState("idle");
        toastTimer.current = null;
      }, 2000);
    } catch {
      setCopyState("fallback");
    }
  };

  return (
    <section className="screen centered-screen">
      <div className="prejoin-card">
        <h1>Вход в комнату</h1>

        <form noValidate onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="display-name">
            Никнейм
          </label>
          <input
            className="text-input"
            id="display-name"
            name="displayName"
            type="text"
            value={displayName}
            autoComplete="nickname"
            autoFocus
            aria-invalid={nameError ? "true" : undefined}
            aria-describedby={nameError ? "display-name-error" : undefined}
            onChange={(event) => {
              setDisplayName(event.target.value);
              if (nameWasChecked) {
                const result = validateDisplayName(event.target.value);
                setNameError(result.valid ? null : result.error);
              }
            }}
            onBlur={checkName}
          />

          {nameError && (
            <p className="field-error" id="display-name-error" role="alert">
              {errorMessages[nameError]}.
            </p>
          )}

          <div className="audio-row">
            <span className="audio-row__icon" aria-hidden="true">
              {microphoneEnabled ? <MicIcon /> : <MicOffIcon />}
            </span>
            <span className="audio-row__copy">
              <strong>Микрофон {microphoneEnabled ? "включён" : "выключен"}</strong>
              <span>{selectedInput.label}</span>
            </span>
            <button
              className="mic-switch"
              type="button"
              role="switch"
              aria-checked={microphoneEnabled}
              aria-label={microphoneEnabled ? "Выключить микрофон" : "Включить микрофон"}
              onClick={() => setMicrophoneEnabled((value) => !value)}
            >
              <span aria-hidden="true" />
            </button>
          </div>

          <div className="prejoin-actions">
            <button className="button button--primary" type="submit">
              Войти в разговор
            </button>
            <button
              className="button button--icon"
              type="button"
              aria-label="Копировать ссылку"
              title="Копировать ссылку"
              onClick={handleCopy}
            >
              <LinkIcon />
            </button>
            <button
              ref={settingsButton}
              className="button button--icon"
              type="button"
              aria-label="Настроить звук"
              title="Настроить звук"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
            </button>
          </div>
        </form>

        {copyState === "fallback" && (
          <div className="copy-fallback" role="status">
            <p>Скопируй ссылку вручную:</p>
            <input
              ref={fallbackInput}
              className="text-input text-input--compact"
              value={window.location.href}
              readOnly
              aria-label="Ссылка на комнату"
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        )}
      </div>

      <div className="toast" data-visible={copyState === "copied"} role="status" aria-live="polite">
        {copyState === "copied" && (
          <>
            <CheckIcon />
            <span>Ссылка скопирована</span>
          </>
        )}
      </div>

      {settingsOpen && (
        <AudioSettingsDialog selectedInput={selectedInput} onInputChange={setSelectedInput} onClose={closeSettings} />
      )}
    </section>
  );
}
