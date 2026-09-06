export interface CallParticipant {
  identity: string;
  name: string;
  isLocal: boolean;
  microphoneEnabled: boolean;
  speaking: boolean;
}

export interface CallSnapshot {
  connection: "connecting" | "connected" | "reconnecting" | "disconnected";
  participants: CallParticipant[];
  audioPlaybackBlocked: boolean;
  disconnectReason: "finished" | "full" | "connection" | null;
}

export interface JoinCredentials {
  serverUrl: string;
  participantToken: string;
  participantIdentity: string;
}

export type MediaErrorCode =
  | "microphone_denied"
  | "microphone_not_found"
  | "microphone_unavailable"
  | "connection_failed"
  | "room_full"
  | "room_finished";

export class MediaError extends Error {
  readonly code: MediaErrorCode;

  constructor(code: MediaErrorCode) {
    super(code);
    this.name = "MediaError";
    this.code = code;
  }
}

export interface MediaSession {
  getSnapshot(): CallSnapshot;
  subscribe(listener: () => void): () => void;
  prepareMicrophone(inputId: string): Promise<void>;
  connect(credentials: JoinCredentials): Promise<void>;
  setMicrophoneEnabled(enabled: boolean, inputId: string): Promise<void>;
  setInputDevice(deviceId: string): Promise<void>;
  setOutputDevice(deviceId: string): Promise<void>;
  startAudio(): Promise<void>;
  disconnect(): Promise<void>;
}
