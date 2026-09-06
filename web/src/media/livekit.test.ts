import { ConnectionError, DisconnectReason, RoomEvent, Track, TrackEvent } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMediaSession } from "./livekit";
import type { MediaSession } from "./session";

const sdk = vi.hoisted(() => ({ Room: vi.fn(), createLocalAudioTrack: vi.fn(), setLogLevel: vi.fn() }));

vi.mock("livekit-client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...sdk,
}));

function audioTrack() {
  const listeners = new Map<string, Set<() => void>>();
  const track = {
    kind: Track.Kind.Audio,
    source: Track.Source.Microphone,
    isMuted: false,
    mediaStreamTrack: { readyState: "live" as MediaStreamTrackState },
    stop: vi.fn(() => { track.mediaStreamTrack.readyState = "ended"; }),
    setDeviceId: vi.fn().mockResolvedValue(true),
    restartTrack: vi.fn(async () => {
      track.mediaStreamTrack = { readyState: "live" };
      track.emit(TrackEvent.Restarted);
    }),
    mute: vi.fn(async () => { track.isMuted = true; }),
    unmute: vi.fn(async () => { track.isMuted = false; }),
    on: vi.fn((event: string, listener: () => void) => {
      const handlers = listeners.get(event) ?? new Set();
      handlers.add(listener);
      listeners.set(event, handlers);
      return track;
    }),
    off: vi.fn((event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener);
      return track;
    }),
    emit: (event: string) => {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    listenerCount: () => [...listeners.values()].reduce((count, handlers) => count + handlers.size, 0),
  };
  return track;
}

function remoteTrack(kind: Track.Kind = Track.Kind.Audio) {
  const element = document.createElement(kind === Track.Kind.Audio ? "audio" : "video");
  return { kind, element, attach: vi.fn(() => element), detach: vi.fn(() => [element]) };
}

function participant(identity: string, name?: string) {
  return {
    identity,
    name,
    isSpeaking: false,
    isMicrophoneEnabled: true,
    trackPublications: new Map<string, ReturnType<typeof publication>>(),
  };
}

function publication(kind: Track.Kind = Track.Kind.Audio) {
  return { kind, setSubscribed: vi.fn() };
}

function fakeRoom() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const tracks = new Map<string, { track: ReturnType<typeof audioTrack> }>();
  const room = {
    localParticipant: {
      identity: "local-identity",
      name: "Мой ник",
      isSpeaking: false,
      get isMicrophoneEnabled() { return [...tracks.values()].some(({ track }) => !track.isMuted); },
      trackPublications: tracks,
      publishTrack: vi.fn(async (track: ReturnType<typeof audioTrack>) => {
        tracks.set("microphone", { track });
        room.emit(RoomEvent.LocalTrackPublished);
      }),
      unpublishTrack: vi.fn(async () => { tracks.clear(); }),
    },
    remoteParticipants: new Map<string, ReturnType<typeof participant>>(),
    canPlaybackAudio: true,
    connect: vi.fn(async () => { room.emit(RoomEvent.Connected); }),
    disconnect: vi.fn(async () => { room.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED); }),
    switchActiveDevice: vi.fn().mockResolvedValue(true),
    startAudio: vi.fn(async () => {
      room.canPlaybackAudio = true;
      room.emit(RoomEvent.AudioPlaybackStatusChanged);
    }),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const handlers = listeners.get(event) ?? new Set();
      handlers.add(listener);
      listeners.set(event, handlers);
      return room;
    }),
    removeAllListeners: vi.fn(() => listeners.clear()),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    listenerCount: () => [...listeners.values()].reduce((count, handlers) => count + handlers.size, 0),
  };
  return room;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const credentials = {
  serverUrl: "wss://example.test",
  participantToken: "test-participant-token",
  participantIdentity: "local-identity",
};

let room: ReturnType<typeof fakeRoom>;
let session: MediaSession;

beforeEach(() => {
  room = fakeRoom();
  sdk.Room.mockImplementation(function () { return room; });
  sdk.createLocalAudioTrack.mockImplementation(async () => audioTrack());
  session = createMediaSession();
});

afterEach(async () => {
  await session.disconnect();
});

describe("LiveKit voice session", () => {
  it("publishes the prepared microphone once and subscribes only to audio", async () => {
    const remote = participant("remote", "Друг");
    const audio = publication();
    const video = publication(Track.Kind.Video);
    remote.trackPublications.set("audio", audio);
    remote.trackPublications.set("video", video);
    room.remoteParticipants.set(remote.identity, remote);

    await session.prepareMicrophone("headset");
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    await session.connect(credentials);
    await session.setMicrophoneEnabled(false, "headset");
    expect(session.getSnapshot().participants[0].microphoneEnabled).toBe(false);
    await session.setMicrophoneEnabled(true, "headset");

    expect(room.connect).toHaveBeenCalledWith(credentials.serverUrl, credentials.participantToken, { autoSubscribe: false });
    expect(sdk.createLocalAudioTrack).toHaveBeenCalledTimes(1);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(expect.anything(), { source: Track.Source.Microphone });
    expect(audio.setSubscribed).toHaveBeenCalledWith(true);
    expect(video.setSubscribed).toHaveBeenCalledWith(false);
    expect(session.getSnapshot().participants[0].microphoneEnabled).toBe(true);
    expect(sdk.setLogLevel).toHaveBeenCalledWith("silent");
  });

  it("joins without requesting microphone permission and enables it later", async () => {
    await session.connect(credentials);

    expect(sdk.createLocalAudioTrack).not.toHaveBeenCalled();
    expect(session.getSnapshot().participants[0].microphoneEnabled).toBe(false);
    await session.setMicrophoneEnabled(true, "default");

    expect(room.connect).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().participants[0].microphoneEnabled).toBe(true);
  });

  it("keeps arrival order stable while names, speakers, mute and membership change", async () => {
    const first = participant("first", "Друг");
    const second = participant("second", " ");
    room.remoteParticipants.set(first.identity, first);
    await session.connect(credentials);
    room.remoteParticipants.set(second.identity, second);
    room.emit(RoomEvent.ParticipantConnected, second);

    first.isSpeaking = true;
    second.isSpeaking = true;
    room.emit(RoomEvent.ActiveSpeakersChanged, [second, first]);
    expect(session.getSnapshot().participants.map(({ identity }) => identity)).toEqual(["local-identity", "first", "second"]);
    expect(session.getSnapshot().participants[2].name).toBe("Участник");
    expect(session.getSnapshot().participants.slice(1).every(({ speaking }) => speaking)).toBe(true);

    first.isMicrophoneEnabled = false;
    room.emit(RoomEvent.TrackMuted);
    second.name = "Новый ник";
    room.emit(RoomEvent.ParticipantNameChanged);
    expect(session.getSnapshot().participants[1].speaking).toBe(false);
    expect(session.getSnapshot().participants[2].name).toBe("Новый ник");

    room.remoteParticipants.delete(first.identity);
    room.emit(RoomEvent.ParticipantDisconnected, first);
    expect(session.getSnapshot().participants.map(({ identity }) => identity)).toEqual(["local-identity", "second"]);
  });

  it("provides cached snapshots and unsubscribes observers", async () => {
    const initial = session.getSnapshot();
    expect(session.getSnapshot()).toBe(initial);
    const observer = vi.fn();
    const unsubscribe = session.subscribe(observer);
    await session.connect(credentials);
    expect(observer).toHaveBeenCalled();
    const connected = session.getSnapshot();
    expect(session.getSnapshot()).toBe(connected);
    unsubscribe();
    observer.mockClear();
    room.emit(RoomEvent.Reconnecting);
    expect(observer).not.toHaveBeenCalled();
    expect(session.getSnapshot()).not.toBe(connected);
  });

  it("attaches remote audio and cleans audio nodes on unsubscribe and participant departure", async () => {
    await session.connect(credentials);
    const remote = participant("remote");
    const audio = remoteTrack();
    const video = remoteTrack(Track.Kind.Video);
    const otherAudio = remoteTrack();
    room.emit(RoomEvent.TrackSubscribed, audio, publication(), remote);
    room.emit(RoomEvent.TrackSubscribed, audio, publication(), remote);
    room.emit(RoomEvent.TrackSubscribed, video, publication(Track.Kind.Video), remote);
    room.emit(RoomEvent.TrackSubscribed, otherAudio, publication(), remote);
    expect(document.body.contains(audio.element)).toBe(true);
    expect(audio.attach).toHaveBeenCalledTimes(1);
    expect(video.attach).not.toHaveBeenCalled();

    room.emit(RoomEvent.TrackUnsubscribed, audio);
    expect(document.body.contains(audio.element)).toBe(false);
    room.emit(RoomEvent.ParticipantDisconnected, remote);
    expect(document.body.contains(otherAudio.element)).toBe(false);
    expect(otherAudio.detach).toHaveBeenCalled();
  });

  it("reports autoplay blocking and recovers audio from a user action", async () => {
    await session.connect(credentials);
    room.canPlaybackAudio = false;
    room.emit(RoomEvent.AudioPlaybackStatusChanged);
    expect(session.getSnapshot().audioPlaybackBlocked).toBe(true);

    await session.startAudio();
    expect(room.startAudio).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().audioPlaybackBlocked).toBe(false);
  });

  it("keeps autoplay recovery available when the browser rejects playback again", async () => {
    await session.connect(credentials);
    room.startAudio.mockRejectedValueOnce(new Error("private SDK error"));
    await expect(session.startAudio()).rejects.toMatchObject({ message: "connection_failed" });
    expect(session.getSnapshot().audioPlaybackBlocked).toBe(true);
    await session.startAudio();
    expect(session.getSnapshot().audioPlaybackBlocked).toBe(false);
  });

  it("preserves selected output before connecting and uses default output without setSinkId", async () => {
    await session.setOutputDevice("default");
    expect(room.switchActiveDevice).not.toHaveBeenCalled();
    await session.setOutputDevice("headset-output");
    await session.connect(credentials);
    expect(room.switchActiveDevice).toHaveBeenCalledWith("audiooutput", "headset-output");

    await session.setOutputDevice("default");
    expect(room.switchActiveDevice).toHaveBeenLastCalledWith("audiooutput", "default");
  });

  it.each(["resolve", "reject"] as const)("applies rapid output choices in order when the first can %s", async (outcome) => {
    const switching = deferred<boolean>();
    let appliedOutput = "default";
    room.switchActiveDevice.mockImplementation(async (_kind: string, deviceId: string) => {
      if (deviceId === "headset-a") await switching.promise;
      appliedOutput = deviceId;
      return true;
    });
    const first = session.setOutputDevice("headset-a");
    const second = session.setOutputDevice("headset-b");
    const settled = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(room.switchActiveDevice).toHaveBeenCalledTimes(1));
    expect(appliedOutput).toBe("default");
    if (outcome === "resolve") switching.resolve(true);
    else switching.reject(new Error("private output details"));
    const results = await settled;

    expect(results[0].status).toBe(outcome === "resolve" ? "fulfilled" : "rejected");
    expect(results[1].status).toBe("fulfilled");
    expect(room.switchActiveDevice).toHaveBeenNthCalledWith(1, "audiooutput", "headset-a");
    expect(room.switchActiveDevice).toHaveBeenNthCalledWith(2, "audiooutput", "headset-b");
    expect(appliedOutput).toBe("headset-b");
    await session.setOutputDevice("headset-b");
    expect(room.switchActiveDevice).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "NotAllowedError", code: "microphone_denied" },
    { name: "NotFoundError", code: "microphone_not_found" },
    { name: "NotReadableError", code: "microphone_unavailable" },
  ])("sanitizes $name and allows retry without reconnecting", async ({ name, code }) => {
    await session.connect(credentials);
    sdk.createLocalAudioTrack.mockRejectedValueOnce(new DOMException("private device details", name));
    await expect(session.setMicrophoneEnabled(true, "default")).rejects.toMatchObject({ code, message: code });
    expect(session.getSnapshot().connection).toBe("connected");
    await session.setMicrophoneEnabled(true, "default");
    expect(session.getSnapshot().participants[0].microphoneEnabled).toBe(true);
    expect(room.connect).toHaveBeenCalledTimes(1);
  });

  it("switches the existing microphone without publishing duplicate tracks", async () => {
    const track = audioTrack();
    sdk.createLocalAudioTrack.mockResolvedValueOnce(track);
    await session.prepareMicrophone("default");
    await session.connect(credentials);
    await session.setInputDevice("new-headset");
    expect(track.setDeviceId).toHaveBeenCalledWith("new-headset");
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
  });

  it("releases captured audio after publication fails and retries with a new microphone", async () => {
    const track = audioTrack();
    sdk.createLocalAudioTrack.mockResolvedValueOnce(track);
    room.localParticipant.publishTrack.mockRejectedValueOnce(new Error("private publication failure"));
    await session.connect(credentials);
    await expect(session.setMicrophoneEnabled(true, "default")).rejects.toMatchObject({ code: "microphone_unavailable" });
    expect(track.stop).toHaveBeenCalled();
    expect(session.getSnapshot().connection).toBe("connected");

    await session.setMicrophoneEnabled(true, "default");
    expect(sdk.createLocalAudioTrack).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().participants[0].microphoneEnabled).toBe(true);
  });

  it("shows reconnecting without keeping stale speaking indicators", async () => {
    const remote = participant("remote");
    remote.isSpeaking = true;
    room.remoteParticipants.set(remote.identity, remote);
    await session.connect(credentials);
    room.emit(RoomEvent.Reconnecting);
    expect(session.getSnapshot().connection).toBe("reconnecting");
    expect(session.getSnapshot().participants[1].speaking).toBe(false);
    room.emit(RoomEvent.Reconnected);
    expect(session.getSnapshot().connection).toBe("connected");
    expect(session.getSnapshot().participants[1].speaking).toBe(true);
  });

  it.each([false, true])("publishes a listener's microphone after reconnect, muted during the wait: %s", async (muted) => {
    const track = audioTrack();
    const reconnecting = deferred<void>();
    const publish = room.localParticipant.publishTrack.getMockImplementation()!;
    sdk.createLocalAudioTrack.mockResolvedValueOnce(track);
    await session.connect(credentials);
    room.emit(RoomEvent.Reconnecting);
    room.localParticipant.publishTrack.mockImplementationOnce(async (microphone) => {
      await reconnecting.promise;
      await publish(microphone);
    });
    const enabling = session.setMicrophoneEnabled(true, "default");
    await vi.waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalled());
    if (muted) {
      await session.setMicrophoneEnabled(false, "default");
      expect(track.isMuted).toBe(true);
    }
    room.emit(RoomEvent.Reconnected);
    reconnecting.resolve();
    await enabling;
    expect(session.getSnapshot().connection).toBe("connected");
    expect(session.getSnapshot().participants[0].microphoneEnabled).toBe(!muted);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
  });

  it("marks an ended microphone unavailable and retries by replacing its underlying capture", async () => {
    const track = audioTrack();
    sdk.createLocalAudioTrack.mockResolvedValueOnce(track);
    await session.prepareMicrophone("default");
    await session.connect(credentials);
    room.localParticipant.isSpeaking = true;
    const endedCapture = track.mediaStreamTrack;
    endedCapture.readyState = "ended";
    track.emit(TrackEvent.Ended);
    expect(session.getSnapshot().participants[0]).toMatchObject({ microphoneEnabled: false, speaking: false });

    await session.setMicrophoneEnabled(true, "default");
    expect(track.restartTrack).toHaveBeenCalledWith({ deviceId: "default" });
    expect(track.mediaStreamTrack).not.toBe(endedCapture);
    expect(session.getSnapshot().participants[0].microphoneEnabled).toBe(true);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
  });

  it("reflects an automatic SDK microphone recovery after unplug", async () => {
    const track = audioTrack();
    sdk.createLocalAudioTrack.mockResolvedValueOnce(track);
    await session.prepareMicrophone("default");
    await session.connect(credentials);
    track.mediaStreamTrack.readyState = "ended";
    track.emit(TrackEvent.Ended);
    expect(session.getSnapshot().participants[0].microphoneEnabled).toBe(false);
    await track.restartTrack();
    expect(session.getSnapshot().participants[0].microphoneEnabled).toBe(true);
  });

  it("keeps an ended microphone disabled when reacquisition fails and permits another retry", async () => {
    const track = audioTrack();
    sdk.createLocalAudioTrack.mockResolvedValueOnce(track);
    await session.prepareMicrophone("default");
    await session.connect(credentials);
    track.mediaStreamTrack.readyState = "ended";
    track.emit(TrackEvent.Ended);
    track.restartTrack.mockRejectedValueOnce(new DOMException("private hardware details", "NotFoundError"));
    await expect(session.setMicrophoneEnabled(true, "default")).rejects.toMatchObject({ code: "microphone_not_found" });
    expect(session.getSnapshot().participants[0].microphoneEnabled).toBe(false);
    await session.setMicrophoneEnabled(true, "default");
    expect(session.getSnapshot().participants[0].microphoneEnabled).toBe(true);
  });

  it.each([
    { reason: DisconnectReason.ROOM_DELETED, expected: "finished" },
    { reason: DisconnectReason.ROOM_CLOSED, expected: "finished" },
    { reason: DisconnectReason.PARTICIPANT_REMOVED, expected: "connection" },
    { reason: DisconnectReason.SIGNAL_CLOSE, expected: "connection" },
    { reason: undefined, expected: "connection" },
  ])("distinguishes terminal room state for disconnect $reason", async ({ reason, expected }) => {
    await session.connect(credentials);
    room.emit(RoomEvent.Disconnected, reason);
    expect(session.getSnapshot()).toMatchObject({ connection: "disconnected", disconnectReason: expected, participants: [] });
    expect(room.listenerCount()).toBe(0);
  });

  it.each([
    { error: ConnectionError.leaveRequest("private details", DisconnectReason.ROOM_DELETED), expected: "room_finished" },
    { error: ConnectionError.internal("private details", { status: 503 }), expected: "connection_failed" },
    { error: ConnectionError.notAllowed("private details", 403), expected: "connection_failed" },
  ])("sanitizes failed connections as $expected without guessing capacity", async ({ error, expected }) => {
    room.connect.mockRejectedValueOnce(error);
    await expect(session.connect(credentials)).rejects.toMatchObject({ code: expected, message: expected });
    expect(session.getSnapshot().connection).toBe("disconnected");
    expect(room.listenerCount()).toBe(0);
  });
});

describe("session disposal races", () => {
  it("does not start an output change queued before disconnect", async () => {
    const switching = deferred<boolean>();
    room.switchActiveDevice.mockReturnValueOnce(switching.promise);
    const first = session.setOutputDevice("headset-a");
    const second = session.setOutputDevice("headset-b");
    const settled = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(room.switchActiveDevice).toHaveBeenCalledTimes(1));
    await session.disconnect();
    switching.resolve(true);
    const results = await settled;

    expect(results).toEqual([
      { status: "rejected", reason: expect.objectContaining({ code: "connection_failed" }) },
      { status: "rejected", reason: expect.objectContaining({ code: "connection_failed" }) },
    ]);
    expect(room.switchActiveDevice).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().connection).toBe("disconnected");
  });

  it.each(["input", "unmute"] as const)("stops audio acquired by a late %s device operation", async (operation) => {
    const track = audioTrack();
    const switching = deferred<boolean>();
    const unmuting = deferred<void>();
    sdk.createLocalAudioTrack.mockResolvedValueOnce(track);
    await session.prepareMicrophone("default");
    await session.connect(credentials);
    track.setDeviceId.mockReturnValueOnce(switching.promise);
    track.unmute.mockReturnValueOnce(unmuting.promise);
    const pending = operation === "input"
      ? session.setInputDevice("headset")
      : session.setMicrophoneEnabled(true, "default");
    const rejected = expect(pending).rejects.toMatchObject({ code: "connection_failed" });
    await vi.waitFor(() => expect(operation === "input" ? track.setDeviceId : track.unmute).toHaveBeenCalled());
    await session.disconnect();
    track.stop.mockClear();
    switching.resolve(true);
    unmuting.resolve();
    await rejected;
    expect(track.stop).toHaveBeenCalled();
  });

  it("stops a microphone whose permission request completes after leaving", async () => {
    const track = audioTrack();
    const permission = deferred<ReturnType<typeof audioTrack>>();
    sdk.createLocalAudioTrack.mockReturnValueOnce(permission.promise);
    const preparing = session.prepareMicrophone("default");
    const rejected = expect(preparing).rejects.toMatchObject({ code: "connection_failed" });
    await Promise.resolve();
    await session.disconnect();
    permission.resolve(track);
    await rejected;
    expect(track.stop).toHaveBeenCalled();
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(session.getSnapshot().participants).toEqual([]);
  });

  it.each(["resolve", "reject"] as const)("cleans a connection that can %s after leaving", async (outcome) => {
    const connection = deferred<void>();
    room.connect.mockReturnValueOnce(connection.promise);
    const connecting = session.connect(credentials);
    const rejected = expect(connecting).rejects.toMatchObject({ code: "connection_failed" });
    await session.disconnect();
    if (outcome === "resolve") connection.resolve();
    else connection.reject(new Error("late private SDK error"));
    await rejected;
    expect(session.getSnapshot().connection).toBe("disconnected");
    expect(room.disconnect.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(room.listenerCount()).toBe(0);
  });

  it("unpublishes late publication after disconnect and releases captured media", async () => {
    const track = audioTrack();
    const publishing = deferred<void>();
    sdk.createLocalAudioTrack.mockResolvedValueOnce(track);
    room.localParticipant.publishTrack.mockReturnValueOnce(publishing.promise);
    await session.prepareMicrophone("default");
    const connecting = session.connect(credentials);
    const rejected = expect(connecting).rejects.toMatchObject({ code: "connection_failed" });
    await vi.waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalled());
    await session.disconnect();
    publishing.resolve();
    await rejected;
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(track, true);
    expect(track.stop).toHaveBeenCalled();
  });

  it("cleans all tracks, audio nodes, observers and credentials on repeated disposal", async () => {
    const track = audioTrack();
    const audio = remoteTrack();
    sdk.createLocalAudioTrack.mockResolvedValueOnce(track);
    await session.prepareMicrophone("default");
    await session.connect(credentials);
    room.emit(RoomEvent.TrackSubscribed, audio, publication(), participant("remote"));
    const observer = vi.fn(() => { void session.disconnect(); });
    session.subscribe(observer);
    await session.disconnect();
    await session.disconnect();

    expect(track.stop).toHaveBeenCalled();
    expect(track.listenerCount()).toBe(0);
    expect(document.body.contains(audio.element)).toBe(false);
    expect(room.listenerCount()).toBe(0);
    expect(room.disconnect).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toEqual({
      connection: "disconnected", participants: [], audioPlaybackBlocked: false, disconnectReason: null,
    });
    await expect(session.connect(credentials)).rejects.toMatchObject({ code: "connection_failed" });
    await expect(session.prepareMicrophone("default")).rejects.toMatchObject({ code: "connection_failed" });
  });
});
