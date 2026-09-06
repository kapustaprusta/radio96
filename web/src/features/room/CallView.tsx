import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { IconButton } from "../../components/IconButton";
import { LinkIcon, LogOutIcon, MicIcon, MicOffIcon, SettingsIcon, VolumeIcon } from "../../components/Icons";
import { MediaError } from "../../media/session";
import type { CallSnapshot, MediaSession } from "../../media/session";
import { AudioSettingsDialog } from "./AudioSettingsDialog";
import { InviteLinkFeedback } from "./InviteLinkFeedback";
import type { JoinPreferences } from "./joinPreferences";
import { participantColor, participantCountLabel, participantInitials } from "./participantPresentation";
import { useInviteLink } from "./useInviteLink";

interface CallViewProps {
  snapshot: CallSnapshot;
  session: MediaSession;
  restoredAt?: number;
  preferences: JoinPreferences;
  onPreferencesChange: Dispatch<SetStateAction<JoinPreferences>>;
  onLeave: () => void;
}

export function CallView({
  snapshot, session, restoredAt, preferences, onPreferencesChange, onLeave,
}: CallViewProps) {
  const [now, setNow] = useState(() => Date.now());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [microphoneBusy, setMicrophoneBusy] = useState(false);
  const [microphoneError, setMicrophoneError] = useState("");
  const [audioError, setAudioError] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const changingMicrophone = useRef(false);
  const active = useRef(true);
  const { copyState, copy, dismiss } = useInviteLink();
  const microphoneEnabled = snapshot.participants.find((participant) => participant.isLocal)?.microphoneEnabled ?? false;

  useEffect(() => {
    active.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active.current = false;
      window.clearInterval(timer);
    };
  }, []);

  const toggleMicrophone = async () => {
    if (changingMicrophone.current) return;
    changingMicrophone.current = true;
    setMicrophoneBusy(true);
    setMicrophoneError("");
    try {
      await session.setMicrophoneEnabled(!microphoneEnabled, preferences.input.deviceId);
      if (active.current) onPreferencesChange((current) => ({ ...current, microphoneEnabled: !microphoneEnabled }));
    } catch (error: unknown) {
      if (active.current) {
        const code = error instanceof MediaError ? error.code : "microphone_unavailable";
        setMicrophoneError(code === "microphone_denied"
          ? "Разреши доступ к микрофону в настройках браузера. Ты можешь продолжать слушать."
          : code === "microphone_not_found"
            ? "Микрофон не найден. Подключи устройство и попробуй снова."
            : "Не удалось переключить микрофон. Проверь устройство и попробуй снова.");
      }
    } finally {
      changingMicrophone.current = false;
      if (active.current) setMicrophoneBusy(false);
    }
  };

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsButton.current?.focus());
  }, []);
  const banner = snapshot.connection === "reconnecting" ? "Связь прервалась. Переподключаемся…"
    : restoredAt !== undefined && now - restoredAt < 3000 ? "Связь восстановлена" : "";

  return (
    <section className="screen call-screen" aria-label="Разговор">
      <header className="sr-only">
        <h1>Голосовая комната</h1>
        <p>{participantCountLabel(snapshot.participants.length)}</p>
      </header>
      {banner && <div className="connection-banner" role="status">{banner}</div>}
      {(snapshot.audioPlaybackBlocked || audioError) && (
        <div className="connection-banner connection-banner--audio">
          <span>{audioError ? "Не удалось включить звук. Попробуй ещё раз." : "Нажми, чтобы слышать участников."}</span>
          <button className="button button--secondary" type="button" onClick={async () => {
            try { await session.startAudio(); if (active.current) setAudioError(false); }
            catch { if (active.current) setAudioError(true); }
          }}><VolumeIcon />Включить звук</button>
        </div>
      )}
      <div className="participant-scroll">
        <div className="participant-grid" data-count={snapshot.participants.length}>
          {snapshot.participants.map((participant) => {
            const speaking = participant.speaking && participant.microphoneEnabled;
            const status = speaking ? "говорит" : participant.microphoneEnabled ? "Микрофон включён" : "Микрофон выключен";
            return (
              <article
                key={participant.identity}
                className="participant"
                data-speaking={speaking}
                aria-label={`${participant.name}${participant.isLocal ? ", это ты" : ""}, ${status}`}
              >
                <div className="participant__avatar-wrap">
                  <div className="participant__avatar" style={{ background: participantColor(participant.identity, participant.isLocal) }}>
                    {participantInitials(participant.name)}
                  </div>
                  <span className="participant__microphone" data-muted={!participant.microphoneEnabled} aria-hidden="true">
                    {participant.microphoneEnabled ? <MicIcon /> : <MicOffIcon />}
                  </span>
                </div>
                <div className="participant__name" title={participant.name}>
                  {participant.name}{participant.isLocal && <span> · ты</span>}
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <div className="call-feedback">
        {microphoneError && <p className="field-error" role="alert">{microphoneError}</p>}
        <InviteLinkFeedback copyState={copyState} onDismiss={dismiss} />
      </div>
      <div className="call-controls" aria-label="Управление разговором">
        <IconButton
          className="call-microphone"
          role="switch"
          aria-checked={microphoneEnabled}
          aria-label={microphoneEnabled ? "Выключить микрофон" : "Включить микрофон"}
          tooltip={microphoneEnabled ? "Микрофон включён" : "Микрофон выключен"}
          disabled={microphoneBusy}
          onClick={toggleMicrophone}
        >{microphoneEnabled ? <MicIcon /> : <MicOffIcon />}</IconButton>
        <IconButton aria-label="Копировать ссылку" tooltip="Копировать ссылку" onClick={copy}>
          <LinkIcon />
        </IconButton>
        <IconButton
          ref={settingsButton}
          aria-label="Настроить звук"
          tooltip="Настройки звука"
          onClick={() => setSettingsOpen(true)}
        ><SettingsIcon /></IconButton>
        <IconButton onClick={onLeave} aria-label="Выйти из разговора" tooltip="Выйти из разговора">
          <LogOutIcon />
        </IconButton>
      </div>
      {settingsOpen && (
        <AudioSettingsDialog
          selectedInput={preferences.input}
          selectedOutputId={preferences.outputId}
          microphoneGranted={microphoneEnabled}
          onInputChange={async (input) => {
            await session.setInputDevice(input.deviceId);
            if (active.current) onPreferencesChange((current) => ({ ...current, input }));
          }}
          onOutputChange={async (outputId) => {
            await session.setOutputDevice(outputId);
            if (active.current) onPreferencesChange((current) => ({ ...current, outputId }));
          }}
          onClose={closeSettings}
        />
      )}
    </section>
  );
}
