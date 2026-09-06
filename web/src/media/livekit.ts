import {
  ConnectionError,
  ConnectionErrorReason,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  TrackEvent,
  createLocalAudioTrack,
  setLogLevel,
} from "livekit-client";
import type { LocalAudioTrack, Participant, RemoteParticipant, RemoteTrack, RemoteTrackPublication } from "livekit-client";

import { MediaError } from "./session";
import type { CallParticipant, CallSnapshot, JoinCredentials, MediaSession } from "./session";

export function createMediaSession(): MediaSession {
  // SDK errors may contain credentials and participant metadata, including at warning level.
  setLogLevel("silent");
  return new LiveKitSession();
}

class LiveKitSession implements MediaSession {
  private room: Room | null;
  private snapshot: CallSnapshot = {
    connection: "connecting",
    participants: [],
    audioPlaybackBlocked: false,
    disconnectReason: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly arrivalOrder = new Map<string, number>();
  private readonly audioElements = new Map<RemoteTrack, { element: HTMLMediaElement; identity: string }>();
  private microphone: LocalAudioTrack | null = null;
  private microphonePublished = false;
  private publishingMicrophone: Promise<void> | null = null;
  private microphoneQueue: Promise<void> = Promise.resolve();
  private outputQueue: Promise<void> = Promise.resolve();
  private disconnecting: Promise<void> | null = null;
  private localIdentity = "";
  private inputDevice = "default";
  private outputDevice = "default";
  private started = false;

  constructor() {
    this.room = new Room({ disconnectOnPageLeave: true, stopLocalTrackOnUnpublish: true });
    this.room
      .on(RoomEvent.Connected, this.onConnected)
      .on(RoomEvent.Reconnected, this.onConnected)
      .on(RoomEvent.Reconnecting, this.onReconnecting)
      .on(RoomEvent.SignalReconnecting, this.onReconnecting)
      .on(RoomEvent.Disconnected, this.onDisconnected)
      .on(RoomEvent.ParticipantConnected, this.onParticipantConnected)
      .on(RoomEvent.ParticipantDisconnected, this.onParticipantDisconnected)
      .on(RoomEvent.ParticipantNameChanged, this.syncParticipants)
      .on(RoomEvent.TrackPublished, this.onTrackPublished)
      .on(RoomEvent.TrackUnpublished, this.syncParticipants)
      .on(RoomEvent.TrackSubscribed, this.onTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed)
      .on(RoomEvent.TrackMuted, this.syncParticipants)
      .on(RoomEvent.TrackUnmuted, this.syncParticipants)
      .on(RoomEvent.LocalTrackPublished, this.syncParticipants)
      .on(RoomEvent.LocalTrackUnpublished, this.syncParticipants)
      .on(RoomEvent.ActiveSpeakersChanged, this.syncParticipants)
      .on(RoomEvent.AudioPlaybackStatusChanged, this.onAudioPlaybackChanged);
  }

  getSnapshot = (): CallSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  prepareMicrophone(inputId: string): Promise<void> {
    return this.withMicrophone(async () => {
      await this.getMicrophone(inputId);
    });
  }

  async connect({ serverUrl, participantToken, participantIdentity }: JoinCredentials): Promise<void> {
    const room = this.activeRoom();
    if (this.started) throw new MediaError("connection_failed");
    this.started = true;
    this.localIdentity = participantIdentity;

    try {
      await room.connect(serverUrl, participantToken, { autoSubscribe: false });
      this.activeRoom();
      await this.withMicrophone(async () => {
        if (this.microphone) await this.publishMicrophone(room, await this.getMicrophone(this.inputDevice));
      });
      this.activeRoom();
      this.onConnected();
    } catch (error) {
      const failure = this.snapshot.disconnectReason === "finished" ? new MediaError("room_finished") : connectionError(error);
      const reason = failure.code === "room_finished" ? "finished" : "connection";
      await this.close(this.snapshot.disconnectReason ?? reason);
      // A connection may finish after a preceding disconnect has already resolved.
      await room.disconnect(true).catch(() => undefined);
      throw failure;
    }
  }

  async setMicrophoneEnabled(enabled: boolean, inputId: string): Promise<void> {
    const room = this.activeRoom();
    const track = await this.withMicrophone(async () => {
      if (enabled) {
        const track = await this.getMicrophone(inputId);
        try {
          await track.unmute();
        } finally {
          if (!this.room) track.stop();
        }
        this.activeRoom();
        return track;
      }
      if (this.microphone) await this.microphone.mute();
      return null;
    });
    this.activeRoom();
    // Publication can wait for reconnection. Keep mute/device changes available while it waits.
    if (track && (this.snapshot.connection === "connected" || this.snapshot.connection === "reconnecting")) {
      try {
        await this.publishMicrophone(room, track);
      } catch (error) {
        throw microphoneError(error);
      }
    }
    this.syncParticipants();
  }

  setInputDevice(deviceId: string): Promise<void> {
    return this.withMicrophone(async () => {
      this.inputDevice = deviceId || "default";
      const track = this.microphone;
      if (!track) return;
      try {
        if (!(await track.setDeviceId(this.inputDevice))) throw new MediaError("microphone_unavailable");
      } finally {
        if (!this.room) track.stop();
      }
      this.activeRoom();
    });
  }

  setOutputDevice(deviceId: string): Promise<void> {
    const pending = this.outputQueue.then(async () => {
      const room = this.activeRoom();
      const outputDevice = deviceId || "default";
      // Browsers without setSinkId can still use their default output.
      if (outputDevice === this.outputDevice) return;
      try {
        const switched = await room.switchActiveDevice("audiooutput", outputDevice);
        this.activeRoom();
        if (!switched) throw new MediaError("connection_failed");
        this.outputDevice = outputDevice;
      } catch {
        throw new MediaError("connection_failed");
      }
    });
    this.outputQueue = pending.catch(() => undefined);
    return pending;
  }

  async startAudio(): Promise<void> {
    const room = this.activeRoom();
    try {
      await room.startAudio();
      this.activeRoom();
      this.onAudioPlaybackChanged();
    } catch {
      if (this.room) this.update({ audioPlaybackBlocked: true });
      throw new MediaError("connection_failed");
    }
  }

  disconnect(): Promise<void> {
    return this.close(null);
  }

  private activeRoom(): Room {
    if (!this.room) throw new MediaError("connection_failed");
    return this.room;
  }

  private withMicrophone<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.microphoneQueue.then(async () => {
      this.activeRoom();
      try {
        return await operation();
      } catch (error) {
        throw microphoneError(error);
      }
    });
    this.microphoneQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async getMicrophone(inputId: string): Promise<LocalAudioTrack> {
    const deviceId = inputId || "default";
    if (this.microphone) {
      const track = this.microphone;
      if (track.mediaStreamTrack.readyState === "ended" || this.inputDevice !== deviceId) {
        try {
          if (track.mediaStreamTrack.readyState === "ended") {
            await track.restartTrack({ deviceId });
          } else if (!(await track.setDeviceId(deviceId))) {
            throw new MediaError("microphone_unavailable");
          }
        } finally {
          if (!this.room) track.stop();
        }
      }
      this.activeRoom();
      this.inputDevice = deviceId;
      return track;
    }

    const track = await createLocalAudioTrack({ deviceId, echoCancellation: true, noiseSuppression: true });
    if (!this.room) {
      track.stop();
      throw new MediaError("connection_failed");
    }
    this.microphone = track;
    track.on(TrackEvent.Ended, this.syncParticipants).on(TrackEvent.Restarted, this.syncParticipants);
    this.inputDevice = deviceId;
    return track;
  }

  private async publishMicrophone(room: Room, track: LocalAudioTrack): Promise<void> {
    if (this.microphonePublished) return;
    if (this.publishingMicrophone) return this.publishingMicrophone;
    this.publishingMicrophone = this.publishTrack(room, track);
    try {
      await this.publishingMicrophone;
    } finally {
      this.publishingMicrophone = null;
    }
  }

  private async publishTrack(room: Room, track: LocalAudioTrack): Promise<void> {
    try {
      await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
      this.activeRoom();
      this.microphonePublished = true;
    } catch (error) {
      this.stopMicrophone(track);
      if (this.microphone === track) this.microphone = null;
      await room.localParticipant.unpublishTrack(track, true).catch(() => undefined);
      throw error;
    }
  }

  private stopMicrophone(track: LocalAudioTrack): void {
    track.off(TrackEvent.Ended, this.syncParticipants).off(TrackEvent.Restarted, this.syncParticipants);
    track.stop();
  }

  private onConnected = (): void => {
    if (!this.room) return;
    this.update({ connection: "connected", disconnectReason: null });
    for (const participant of this.room.remoteParticipants.values()) this.subscribeToAudio(participant);
    this.syncParticipants();
    this.onAudioPlaybackChanged();
  };

  private onReconnecting = (): void => {
    if (!this.room) return;
    this.update({ connection: "reconnecting" });
    this.syncParticipants();
  };

  private onDisconnected = (reason?: DisconnectReason): void => {
    void this.close(isFinished(reason) ? "finished" : "connection");
  };

  private onParticipantConnected = (participant: RemoteParticipant): void => {
    this.subscribeToAudio(participant);
    this.syncParticipants();
  };

  private onParticipantDisconnected = (participant: RemoteParticipant): void => {
    for (const [track, audio] of this.audioElements) {
      if (audio.identity === participant.identity) this.detachAudio(track);
    }
    this.syncParticipants();
  };

  private subscribeToAudio(participant: RemoteParticipant): void {
    for (const publication of participant.trackPublications.values()) this.onTrackPublished(publication);
  }

  private onTrackPublished = (publication: RemoteTrackPublication): void => {
    if (!this.room) return;
    publication.setSubscribed(publication.kind === Track.Kind.Audio);
    this.syncParticipants();
  };

  private onTrackSubscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant): void => {
    if (!this.room || track.kind !== Track.Kind.Audio || this.audioElements.has(track)) return;
    const element = track.attach();
    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
    this.audioElements.set(track, { element, identity: participant.identity });
    document.body.append(element);
    // attach starts SDK playback and reports autoplay errors through RoomEvent.AudioPlaybackStatusChanged.
    this.syncParticipants();
  };

  private onTrackUnsubscribed = (track: RemoteTrack): void => {
    this.detachAudio(track);
    this.syncParticipants();
  };

  private detachAudio(track: RemoteTrack): void {
    for (const element of track.detach()) element.remove();
    this.audioElements.get(track)?.element.remove();
    this.audioElements.delete(track);
  }

  private onAudioPlaybackChanged = (): void => {
    if (this.room) this.update({ audioPlaybackBlocked: !this.room.canPlaybackAudio });
  };

  private syncParticipants = (): void => {
    const room = this.room;
    if (!room || !this.started) return;
    const participants: CallParticipant[] = [];
    const local = room.localParticipant;
    if (local.identity || this.localIdentity) {
      participants.push(this.mapParticipant(local, true, local.identity || this.localIdentity));
    }
    for (const remote of room.remoteParticipants.values()) {
      if (!this.arrivalOrder.has(remote.identity)) this.arrivalOrder.set(remote.identity, this.arrivalOrder.size);
    }
    const remotes = [...room.remoteParticipants.values()].sort(
      (left, right) => (this.arrivalOrder.get(left.identity) ?? 0) - (this.arrivalOrder.get(right.identity) ?? 0),
    );
    participants.push(...remotes.map((remote) => this.mapParticipant(remote, false, remote.identity)));
    this.update({ participants });
  };

  private mapParticipant(participant: Participant, isLocal: boolean, identity: string): CallParticipant {
    const microphoneEnabled = participant.isMicrophoneEnabled
      && (!isLocal || this.microphone?.mediaStreamTrack.readyState !== "ended");
    return {
      identity,
      name: participant.name?.trim() || "Участник",
      isLocal,
      microphoneEnabled,
      speaking: this.snapshot.connection === "connected" && microphoneEnabled && participant.isSpeaking,
    };
  }

  private update(patch: Partial<CallSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private close(reason: CallSnapshot["disconnectReason"]): Promise<void> {
    if (this.disconnecting) return this.disconnecting;
    const room = this.room;
    this.room = null;
    room?.removeAllListeners();
    if (this.microphone) this.stopMicrophone(this.microphone);
    this.microphone = null;
    this.microphonePublished = false;
    this.localIdentity = "";
    this.inputDevice = "default";
    this.outputDevice = "default";
    this.arrivalOrder.clear();
    for (const track of this.audioElements.keys()) this.detachAudio(track);
    for (const publication of room?.localParticipant.trackPublications.values() ?? []) publication.track?.stop();
    this.disconnecting = room?.disconnect(true).catch(() => undefined) ?? Promise.resolve();
    this.update({ connection: "disconnected", participants: [], audioPlaybackBlocked: false, disconnectReason: reason });
    this.listeners.clear();
    return this.disconnecting;
  }
}

function microphoneError(error: unknown): MediaError {
  if (error instanceof MediaError) return error;
  if (error instanceof Error || error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") return new MediaError("microphone_denied");
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") return new MediaError("microphone_not_found");
  }
  return new MediaError("microphone_unavailable");
}

function connectionError(error: unknown): MediaError {
  if (error instanceof MediaError) return error;
  if (error instanceof ConnectionError && error.reason === ConnectionErrorReason.LeaveRequest && isFinished(error.context)) {
    return new MediaError("room_finished");
  }
  return new MediaError("connection_failed");
}

function isFinished(reason: unknown): boolean {
  return reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED;
}
