import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { IconButton } from "../../components/IconButton";
import { CheckIcon, LinkIcon, MicIcon, MicOffIcon, SettingsIcon } from "../../components/Icons";
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
  createdRoomExpiry?: string | null;
}

export function PreJoin({
  onJoin,
  initialPreferences = defaultJoinPreferences,
  microphoneError,
  nameRejected = false,
  createdRoomExpiry,
}: PreJoinProps) {
  const [displayName, setDisplayName] = useState(initialPreferences.displayName);
  const [nameError, setNameError] = useState<DisplayNameError | null>(null);
  const [serverNameError, setServerNameError] = useState(nameRejected);
  const [nameWasChecked, setNameWasChecked] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(initialPreferences.microphoneEnabled);
  const [selectedInput, setSelectedInput] = useState<AudioInputChoice>(initialPreferences.input);
  const [selectedOutputId, setSelectedOutputId] = useState(initialPreferences.outputId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [microphonePermission, setMicrophonePermission] = useState<PermissionState | "unknown">("unknown");
  const [permissionPending, setPermissionPending] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState("");
  const { copyState, copy, dismiss } = useInviteLink();
  const settingsButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const permissionRequest = useRef(false);

  const refreshInputLabel = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices();
      if (!mounted.current || !devices) return;
      setSelectedInput((current) => {
        const selected = devices.find((device) => device.kind === "audioinput" && device.deviceId === current.deviceId);
        return selected?.label ? { ...current, label: selected.label } : current;
      });
    } catch { /* Device labels can be unavailable even after permission is granted. */ }
  }, []);

  const handlePermissionChange = useCallback((state: PermissionState, announce = false) => {
    setMicrophonePermission(state);
    setPermissionMessage(announce ? state === "granted" ? "Доступ к микрофону разрешён" : "Нет доступа к микрофону" : "");
    if (state === "granted") void refreshInputLabel();
  }, [refreshInputLabel]);

  useEffect(() => {
    mounted.current = true;
    let permission: PermissionStatus | undefined;
    let active = true;
    const update = () => {
      if (!active || !permission) return;
      setMicrophonePermission(permission.state);
      if (permission.state !== "granted") setPermissionMessage("");
      if (permission.state === "granted") void refreshInputLabel();
    };
    void navigator.permissions?.query({ name: "microphone" as PermissionName }).then((result) => {
      if (!active) return;
      permission = result;
      update();
      permission.addEventListener("change", update);
    }).catch(() => undefined);
    return () => {
      active = false;
      mounted.current = false;
      permission?.removeEventListener("change", update);
    };
  }, [refreshInputLabel]);

  const requestPermission = async () => {
    if (permissionRequest.current) return;
    permissionRequest.current = true;
    setPermissionPending(true);
    setPermissionMessage("");
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("", "NotFoundError");
      const audio = selectedInput.deviceId === "default" ? true : { deviceId: { exact: selectedInput.deviceId } };
      stream = await navigator.mediaDevices.getUserMedia({ audio });
      if (!mounted.current) return;
      setMicrophonePermission("granted");
      await refreshInputLabel();
      if (mounted.current) setPermissionMessage("Доступ к микрофону разрешён");
    } catch (error: unknown) {
      if (!mounted.current) return;
      const name = error instanceof Error ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") setMicrophonePermission("denied");
      setPermissionMessage(name === "NotFoundError" ? "Микрофон не найден" : "Не удалось включить микрофон");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      permissionRequest.current = false;
      if (mounted.current) setPermissionPending(false);
    }
  };

  const checkName = (showEmptyError = true): boolean => {
    const result = validateDisplayName(displayName);
    setNameWasChecked(true);

    if (!result.valid) {
      if (showEmptyError) nameInput.current?.focus();
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

  const hasMicrophoneAccess = microphonePermission === "granted";

  return (
    <section className="screen centered-screen">
      <div className="prejoin-card">
        <h1>Вход в комнату</h1>
        {createdRoomExpiry && (
          <p className="created-room-notice" role="status">
            <CheckIcon />
            <span>Комната создана. Если до{" "}
              <time dateTime={createdRoomExpiry}>{new Date(createdRoomExpiry).toLocaleTimeString("ru", {
                hour: "2-digit", minute: "2-digit",
              })}</time> никто не войдёт, ссылка перестанет действовать.</span>
          </p>
        )}

        <form noValidate onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="display-name">
            Никнейм
          </label>
          <input
            ref={nameInput}
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
          <div className="field-feedback">
            {(nameError || serverNameError) && (
              <p className="field-error" id="display-name-error" role="alert">
                {nameError ? errorMessages[nameError] : "Введи никнейм длиной от 1 до 32 символов"}
              </p>
            )}
            {Array.from(displayName).length >= 28 && (
              <span className="name-count" aria-live="polite">{Array.from(displayName).length}/32</span>
            )}
          </div>

          <div className="audio-row">
            <span className="audio-row__icon" aria-hidden="true">
              {hasMicrophoneAccess && microphoneEnabled ? <MicIcon /> : <MicOffIcon />}
            </span>
            <span className="audio-row__copy">
              <strong>{hasMicrophoneAccess
                ? `Микрофон ${microphoneEnabled ? "будет включён" : "выключен"}` : "Нет доступа к микрофону"}</strong>
              <span>{hasMicrophoneAccess ? selectedInput.label : permissionPending
                ? "Запрашиваем доступ…" : microphonePermission === "denied"
                  ? "Разреши доступ в настройках браузера" : "Разреши доступ, чтобы говорить"}</span>
            </span>
            {hasMicrophoneAccess ? (
              <button
                className="mic-switch"
                type="button"
                role="switch"
                aria-checked={microphoneEnabled}
                aria-label={microphoneEnabled
                  ? "Не включать микрофон при входе" : "Включить микрофон при входе"}
                onClick={() => setMicrophoneEnabled((value) => !value)}
              >
                <span aria-hidden="true" />
              </button>
            ) : (
              <button className="button button--secondary audio-permission" type="button"
                disabled={permissionPending} onClick={() => void requestPermission()}>
                {permissionPending ? "Ожидаем…" : "Разрешить"}
              </button>
            )}
          </div>
          {permissionMessage && <p className="permission-feedback" role={hasMicrophoneAccess ? "status" : "alert"}>{permissionMessage}</p>}

          <div className="prejoin-actions">
            <button className="button button--primary" type="submit" disabled={permissionPending && microphoneEnabled}>
              {microphoneEnabled ? "Присоединиться" : "Войти без микрофона"}
            </button>
            <IconButton
              aria-label="Скопировать ссылку"
              tooltip="Скопировать ссылку"
              onClick={copy}
            >
              <LinkIcon />
            </IconButton>
            <IconButton
              ref={settingsButton}
              aria-label="Настройки звука"
              tooltip="Настройки звука"
              disabled={permissionPending}
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
            </IconButton>
          </div>
          {!hasMicrophoneAccess && microphoneEnabled && (
            <button className="prejoin-listen" type="button" onClick={() => submit(false)}>Войти без микрофона</button>
          )}
        </form>

        <InviteLinkFeedback copyState={copyState} onDismiss={dismiss} />
      </div>

      {settingsOpen && (
        <AudioSettingsDialog
          selectedInput={selectedInput}
          onInputChange={setSelectedInput}
          selectedOutputId={selectedOutputId}
          onOutputChange={setSelectedOutputId}
          microphoneGranted={hasMicrophoneAccess}
          onMicrophonePermissionChange={handlePermissionChange}
          onClose={closeSettings}
        />
      )}
    </section>
  );
}
