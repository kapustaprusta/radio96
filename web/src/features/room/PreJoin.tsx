import { useCallback, useRef, useState } from "react";
import type { FormEvent } from "react";

import { IconButton } from "../../components/IconButton";
import { LinkIcon, MicIcon, MicOffIcon, SettingsIcon } from "../../components/Icons";
import { validateDisplayName } from "../../displayName";
import type { DisplayNameError } from "../../displayName";
import { AudioSettingsDialog } from "./AudioSettingsDialog";
import type { AudioInputChoice } from "./AudioSettingsDialog";
import { InviteLinkFeedback } from "./InviteLinkFeedback";
import { defaultJoinPreferences } from "./joinPreferences";
import type { JoinPreferences } from "./joinPreferences";
import { MicrophoneAccess } from "./MicrophoneAccess";
import { useInviteLink } from "./useInviteLink";

const errorMessages: Record<DisplayNameError, string> = {
  empty: "Введи никнейм",
  "too-long": "Не больше 32 символов",
};

interface PreJoinProps {
  onJoin: (preferences: JoinPreferences) => void;
  initialPreferences?: JoinPreferences;
  microphoneError?: string;
  nameRejected?: boolean;
}

export function PreJoin({
  onJoin,
  initialPreferences = defaultJoinPreferences,
  microphoneError,
  nameRejected = false,
}: PreJoinProps) {
  const [displayName, setDisplayName] = useState(initialPreferences.displayName);
  const [nameError, setNameError] = useState<DisplayNameError | null>(null);
  const [serverNameError, setServerNameError] = useState(nameRejected);
  const [nameWasChecked, setNameWasChecked] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(initialPreferences.microphoneEnabled);
  const [selectedInput, setSelectedInput] = useState<AudioInputChoice>(initialPreferences.input);
  const [selectedOutputId, setSelectedOutputId] = useState(initialPreferences.outputId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { copyState, copy, dismiss } = useInviteLink();
  const settingsButton = useRef<HTMLButtonElement>(null);

  const checkName = (showEmptyError = true): boolean => {
    const result = validateDisplayName(displayName);
    setNameWasChecked(true);

    if (!result.valid) {
      setNameError(result.error === "empty" && !showEmptyError ? null : result.error);
      return false;
    }

    setDisplayName(result.value);
    setNameError(null);
    return true;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(microphoneEnabled);
  };

  const submit = (withMicrophone: boolean) => {
    if (checkName()) {
      onJoin({
        displayName: displayName.trim(),
        microphoneEnabled: withMicrophone,
        input: selectedInput,
        outputId: selectedOutputId,
      });
    }
  };

  const clearEmptyNameError = () => {
    setNameError((error) => error === "empty" ? null : error);
  };

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsButton.current?.focus());
  }, []);

  if (microphoneError) {
    return <MicrophoneAccess error={microphoneError} onRetry={() => submit(true)} onListen={() => submit(false)} />;
  }

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
            aria-invalid={nameError || serverNameError ? "true" : undefined}
            aria-describedby={nameError || serverNameError ? "display-name-error" : "display-name-hint"}
            onFocus={clearEmptyNameError}
            onClick={clearEmptyNameError}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setServerNameError(false);
              if (nameWasChecked) {
                const result = validateDisplayName(event.target.value);
                setNameError(result.valid || result.error === "empty" ? null : result.error);
              }
            }}
            onBlur={() => checkName(false)}
          />

          <p className="sr-only" id="display-name-hint">От 1 до 32 символов</p>
          {(nameError || serverNameError) && (
            <p className="field-error" id="display-name-error" role="alert">
              {nameError ? `${errorMessages[nameError]}.` : "Проверь никнейм: от 1 до 32 символов."}
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
              {microphoneEnabled ? "Войти в разговор" : "Войти без микрофона"}
            </button>
            <IconButton
              aria-label="Копировать ссылку"
              tooltip="Копировать ссылку"
              onClick={copy}
            >
              <LinkIcon />
            </IconButton>
            <IconButton
              ref={settingsButton}
              aria-label="Настроить звук"
              tooltip="Настроить звук"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
            </IconButton>
          </div>
        </form>

        <InviteLinkFeedback copyState={copyState} onDismiss={dismiss} />
      </div>

      {settingsOpen && (
        <AudioSettingsDialog
          selectedInput={selectedInput}
          onInputChange={setSelectedInput}
          selectedOutputId={selectedOutputId}
          onOutputChange={setSelectedOutputId}
          onClose={closeSettings}
        />
      )}
    </section>
  );
}
