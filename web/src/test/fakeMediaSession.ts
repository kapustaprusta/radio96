import { vi } from "vitest";

import type { CallSnapshot, JoinCredentials, MediaSession } from "../media/session";

export class FakeMediaSession implements MediaSession {
  private listeners = new Set<() => void>();
  private microphonePrepared = false;
  snapshot: CallSnapshot = {
    connection: "connecting", participants: [], audioPlaybackBlocked: false, disconnectReason: null,
  };

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  emit(patch: Partial<CallSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  prepareMicrophone = vi.fn<MediaSession["prepareMicrophone"]>(async () => { this.microphonePrepared = true; });
  connect = vi.fn(async (credentials: JoinCredentials) => {
    this.emit({
      connection: "connected",
      participants: [{
        identity: credentials.participantIdentity, name: "Влад", isLocal: true,
        microphoneEnabled: this.microphonePrepared, speaking: false,
      }],
    });
  });
  setMicrophoneEnabled = vi.fn<MediaSession["setMicrophoneEnabled"]>(async (enabled) => {
    this.emit({ participants: this.snapshot.participants.map((person) => person.isLocal
      ? { ...person, microphoneEnabled: enabled } : person) });
  });
  setInputDevice = vi.fn<MediaSession["setInputDevice"]>(async () => undefined);
  setOutputDevice = vi.fn<MediaSession["setOutputDevice"]>(async () => undefined);
  startAudio = vi.fn(async () => { this.emit({ audioPlaybackBlocked: false }); });
  disconnect = vi.fn(async () => {
    this.emit({ connection: "disconnected", participants: [], audioPlaybackBlocked: false });
    this.listeners.clear();
  });
}
