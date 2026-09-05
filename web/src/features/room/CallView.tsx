import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { LinkIcon, MicIcon, MicOffIcon, PhoneOffIcon, SettingsIcon, VolumeIcon } from "../../components/Icons";
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
  startedAt: number;
  restoredAt?: number;
  preferences: JoinPreferences;
  onPreferencesChange: Dispatch<SetStateAction<JoinPreferences>>;
  onLeave: () => void;
}

export function CallView({
  snapshot, session, startedAt, restoredAt, preferences, onPreferencesChange, onLeave,
}: CallViewProps) {
  const [now, setNow] = useState(() => Date.now());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [microphoneBusy, setMicrophoneBusy] = useState(false);
  const [microphoneError, setMicrophoneError] = useState("");
  const [audioError, setAudioError] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const changingMicrophone = useRef(false);
  const active = useRef(true);
  const { copyState, copy } = useInviteLink();
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
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const duration = `${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;
  const banner = snapshot.connection === "reconnecting" ? "Связь прервалась. Переподключаемся…"
    : restoredAt !== undefined && now - restoredAt < 3000 ? "Связь восстановлена" : "";

  return (
    <section className="screen call-screen" aria-label="Разговор">
      <header className="call-header">
        <h1>Голосовая комната</h1>
        <div className="call-header__meta">
          <span>{participantCountLabel(snapshot.participants.length)}</span>
          <span aria-label={`Ты в разговоре ${duration}`}>{duration}</span>
        </div>
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
                <div className="participant__status">{status}</div>
              </article>
            );
          })}
        </div>
        {snapshot.participants.length === 1 && (
          <div className="solo-invite">
            <p>Пока здесь только ты</p>
            <button className="button button--secondary" type="button" onClick={copy}>Пригласить друзей</button>
          </div>
        )}
      </div>
      <div className="call-feedback">
        {microphoneError && <p className="field-error" role="alert">{microphoneError}</p>}
        <InviteLinkFeedback copyState={copyState} />
      </div>
      <div className="call-controls" aria-label="Управление разговором">
        <button
          className="button button--icon call-microphone"
          type="button"
          role="switch"
          aria-checked={microphoneEnabled}
          aria-label={microphoneEnabled ? "Выключить микрофон" : "Включить микрофон"}
          title={microphoneEnabled ? "Микрофон включён" : "Микрофон выключен"}
          disabled={microphoneBusy}
          onClick={toggleMicrophone}
        >{microphoneEnabled ? <MicIcon /> : <MicOffIcon />}</button>
        <button className="button button--icon" type="button" aria-label="Копировать ссылку" title="Копировать ссылку" onClick={copy}>
          <LinkIcon />
        </button>
        <button
          ref={settingsButton}
          className="button button--icon"
          type="button"
          aria-label="Настроить звук"
          title="Настроить звук"
          onClick={() => setSettingsOpen(true)}
        ><SettingsIcon /></button>
        <button className="button button--danger" type="button" onClick={onLeave} aria-label="Выйти из разговора">
          <PhoneOffIcon />Выйти
        </button>
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
