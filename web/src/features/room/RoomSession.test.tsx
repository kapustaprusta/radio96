import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createMediaSession } from "../../media/livekit";
import { MediaError } from "../../media/session";
import type { MediaErrorCode } from "../../media/session";
import { FakeMediaSession } from "../../test/fakeMediaSession";

vi.mock("../../media/livekit", () => ({ createMediaSession: vi.fn() }));

const inviteCode = "A".repeat(32);
const sessions: FakeMediaSession[] = [];

beforeEach(() => {
  sessions.length = 0;
  vi.mocked(createMediaSession).mockImplementation(() => {
    const session = new FakeMediaSession();
    sessions.push(session);
    return session;
  });
  window.history.replaceState(null, "", `/rooms/${inviteCode}`);
});

afterEach(() => { vi.useRealTimers(); vi.mocked(createMediaSession).mockReset(); });

function mockAPI(joinError?: { code: string; status: number }) {
  let attempt = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/join")) {
      attempt += 1;
      return joinError ? jsonResponse({ code: joinError.code, message: "private backend text" }, joinError.status)
        : jsonResponse({ serverUrl: "wss://voice.example", participantToken: `token-${attempt}`, participantIdentity: `self-${attempt}` });
    }
    return jsonResponse({ status: "open", expiresAt: "2026-09-05T20:00:00Z" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function join(withMicrophone = true) {
  const user = userEvent.setup();
  const input = await screen.findByRole("textbox", { name: "Никнейм" });
  await user.type(input, "  Влад  ");
  if (!withMicrophone) await user.click(screen.getByRole("switch", { name: "Выключить микрофон" }));
  await user.click(screen.getByRole("button", { name: withMicrophone ? "Войти в разговор" : "Войти без микрофона" }));
  return user;
}

describe("join and call", () => {
  it.each([true, false])("joins with microphone=%s and sends only the validated name", async (withMicrophone) => {
    const fetchMock = mockAPI();
    render(<App />);
    await join(withMicrophone);

    expect(await screen.findByRole("heading", { name: "Голосовая комната" })).toBeInTheDocument();
    expect(sessions[0].prepareMicrophone).toHaveBeenCalledTimes(withMicrophone ? 1 : 0);
    expect(sessions[0].connect).toHaveBeenCalledWith({
      serverUrl: "wss://voice.example", participantToken: "token-1", participantIdentity: "self-1",
    });
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/rooms/${inviteCode}/join`, expect.objectContaining({
      method: "POST", body: JSON.stringify({ displayName: "Влад" }), cache: "no-store", referrerPolicy: "no-referrer",
    }));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", String(withMicrophone));
    expect(screen.getByText("1 участник")).toBeInTheDocument();
    expect(document.title).not.toContain(inviteCode);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it.each<MediaErrorCode>(["microphone_denied", "microphone_not_found"])(
    "requires explicit listener choice after %s, then allows unmute without a new token", async (code) => {
      const first = new FakeMediaSession();
      first.prepareMicrophone.mockRejectedValueOnce(new MediaError(code));
      vi.mocked(createMediaSession).mockReturnValueOnce(first);
      const fetchMock = mockAPI();
      render(<App />);
      const user = await join();

      expect(await screen.findByRole("button", { name: "Проверить снова" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Никнейм" })).toHaveValue("Влад");
      expect(fetchMock.mock.calls.every(([input]) => !String(input).endsWith("/join"))).toBe(true);
      expect(first.disconnect).toHaveBeenCalledOnce();
      await user.click(screen.getByRole("button", { name: "Войти без микрофона" }));

      expect(await screen.findByRole("heading", { name: "Голосовая комната" })).toBeInTheDocument();
      const listener = sessions[0];
      expect(listener.prepareMicrophone).not.toHaveBeenCalled();
      await user.click(screen.getByRole("switch", { name: "Включить микрофон" }));
      expect(listener.setMicrophoneEnabled).toHaveBeenCalledWith(true, "default");
      expect(listener.connect).toHaveBeenCalledOnce();
      expect(listener.disconnect).not.toHaveBeenCalled();
      expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    },
  );

  it("retries microphone permission while preserving the entered name", async () => {
    const first = new FakeMediaSession();
    first.prepareMicrophone.mockRejectedValueOnce(new MediaError("microphone_denied"));
    vi.mocked(createMediaSession).mockReturnValueOnce(first);
    mockAPI();
    render(<App />);
    const user = await join();
    await user.click(await screen.findByRole("button", { name: "Проверить снова" }));

    expect(await screen.findByRole("heading", { name: "Голосовая комната" })).toBeInTheDocument();
    expect(sessions[0].prepareMicrophone).toHaveBeenCalledOnce();
  });

  it("fetches a fresh token when retrying a failed SDK connection", async () => {
    const first = new FakeMediaSession();
    first.connect.mockRejectedValueOnce(new MediaError("connection_failed"));
    vi.mocked(createMediaSession).mockReturnValueOnce(first);
    mockAPI();
    render(<App />);
    const user = await join(false);
    expect(await screen.findByRole("heading", { name: "Не удалось подключиться" })).toBeInTheDocument();
    expect(first.disconnect).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Попробовать снова" }));

    expect(await screen.findByRole("heading", { name: "Голосовая комната" })).toBeInTheDocument();
    expect(sessions[0].connect).toHaveBeenCalledWith(expect.objectContaining({ participantToken: "token-2" }));
    expect(sessions[0].prepareMicrophone).not.toHaveBeenCalled();
  });

  it("blocks concurrent submits while a microphone request is pending and cancels cleanly", async () => {
    const pending = new FakeMediaSession();
    let resolveMicrophone: (() => void) | undefined;
    pending.prepareMicrophone.mockReturnValue(new Promise<void>((resolve) => { resolveMicrophone = resolve; }));
    vi.mocked(createMediaSession).mockReturnValue(pending);
    const fetchMock = mockAPI();
    render(<App />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "Никнейм" }), "Влад");
    await user.dblClick(screen.getByRole("button", { name: "Войти в разговор" }));
    await screen.findByRole("heading", { name: "Подключаем звук…" });
    expect(createMediaSession).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Отменить" }));
    await act(async () => resolveMicrophone?.());
    expect(pending.disconnect).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Никнейм" })).toHaveValue("Влад");
    expect(fetchMock.mock.calls.every(([input]) => !String(input).endsWith("/join"))).toBe(true);
  });

  it("times out a stalled SDK connection after 15 seconds", async () => {
    const stalled = new FakeMediaSession();
    stalled.connect.mockReturnValue(new Promise(() => undefined));
    vi.mocked(createMediaSession).mockReturnValue(stalled);
    mockAPI();
    render(<App />);
    await screen.findByRole("textbox", { name: "Никнейм" });
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole("textbox", { name: "Никнейм" }), { target: { value: "Влад" } });
    await act(async () => { fireEvent.submit(screen.getByRole("textbox", { name: "Никнейм" }).closest("form")!); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });

    expect(screen.getByRole("heading", { name: "Не удалось подключиться" })).toBeInTheDocument();
    expect(stalled.disconnect).toHaveBeenCalledOnce();
  });

  it.each(["leave", "unmount", "pagehide"] as const)("disposes media after %s", async (action) => {
    mockAPI();
    const { unmount } = render(<App />);
    const user = await join();
    await screen.findByRole("heading", { name: "Голосовая комната" });
    const session = sessions[0];
    if (action === "leave") await user.click(screen.getByRole("button", { name: "Выйти из разговора" }));
    if (action === "unmount") unmount();
    if (action === "pagehide") act(() => window.dispatchEvent(new Event("pagehide")));

    expect(session.disconnect).toHaveBeenCalledOnce();
    expect(session.getSnapshot().participants).toEqual([]);
    if (action === "pagehide") {
      act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      expect(screen.getByRole("heading", { name: "Вход в комнату" })).toBeInTheDocument();
    }
    if (action === "leave") {
      expect(screen.getByRole("heading", { name: "Ты вышел из разговора" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Войти снова" }));
      await screen.findByRole("heading", { name: "Голосовая комната" });
      expect(sessions[1].connect).toHaveBeenCalledWith(expect.objectContaining({ participantToken: "token-2" }));
    }
  });

  it("renders live participants, speaker/mute state, playback recovery and reconnect feedback", async () => {
    mockAPI();
    render(<App />);
    const user = await join();
    await screen.findByRole("heading", { name: "Голосовая комната" });
    const session = sessions[0];
    const longName = "Очень длинное имя участника 🎮";
    act(() => session.emit({
      participants: [...session.snapshot.participants, {
        identity: "friend", name: longName, isLocal: false, microphoneEnabled: true, speaking: true,
      }], audioPlaybackBlocked: true,
    }));
    const tile = screen.getByRole("article", { name: `${longName}, говорит` });
    expect(within(tile).getByText("говорит")).toBeInTheDocument();
    expect(screen.getByTitle(longName)).toBeInTheDocument();
    expect(screen.getByText("2 участника")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Включить звук" }));
    expect(session.startAudio).toHaveBeenCalledOnce();
    act(() => session.emit({ connection: "reconnecting" }));
    expect(screen.getByText("Связь прервалась. Переподключаемся…")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Выключить микрофон" }));
    expect(session.setMicrophoneEnabled).toHaveBeenCalledWith(false, "default");
    act(() => session.emit({ connection: "connected" }));
    expect(screen.getByText("Связь восстановлена")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: `${longName}, говорит` })).toBe(tile);
  });

  it.each([
    { disconnectReason: "connection", title: "Соединение потеряно", canRejoin: true },
    { disconnectReason: "finished", title: "Разговор закончился", canRejoin: false },
  ] as const)("shows $title on remote disconnection", async ({ disconnectReason, title, canRejoin }) => {
    mockAPI();
    render(<App />);
    await join(false);
    await screen.findByRole("heading", { name: "Голосовая комната" });
    act(() => sessions[0].emit({ connection: "disconnected", disconnectReason }));
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(Boolean(screen.queryByRole("button", { name: "Войти снова" }))).toBe(canRejoin);
  });

  it.each([
    { code: "room_not_found", status: 404, title: "Комната не найдена" },
    { code: "room_expired", status: 410, title: "Ссылка больше не действует" },
    { code: "room_finished", status: 410, title: "Разговор уже закончился" },
    { code: "room_full", status: 409, title: "Комната уже заполнена" },
    { code: "media_unavailable", status: 503, title: "Голосовой сервис временно недоступен" },
    { code: "internal_error", status: 500, title: "Что-то пошло не так" },
    { code: "new_unknown_code", status: 400, title: "Не удалось связаться с radio96" },
  ])("maps $code from join without displaying raw server details", async ({ code, status, title }) => {
    mockAPI({ code, status });
    render(<App />);
    await join(false);
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.queryByText("private backend text")).not.toBeInTheDocument();
    expect(sessions[0].connect).not.toHaveBeenCalled();
    expect(sessions[0].disconnect).toHaveBeenCalledOnce();
  });

  it("returns invalid_name to the preserved prejoin field", async () => {
    mockAPI({ code: "invalid_name", status: 400 });
    render(<App />);
    await join(false);
    const input = await screen.findByRole("textbox", { name: "Никнейм" });
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveValue("Влад");
  });

  it("keeps a later mute when a pending output change completes before rejoining", async () => {
    const prototype = HTMLMediaElement.prototype as HTMLMediaElement & { setSinkId?: () => Promise<void> };
    const originalSink = Object.getOwnPropertyDescriptor(prototype, "setSinkId");
    Object.defineProperty(prototype, "setSinkId", { configurable: true, value: vi.fn() });
    const testNavigator = Object.create(navigator) as Navigator;
    Object.defineProperty(testNavigator, "mediaDevices", {
      value: { enumerateDevices: vi.fn().mockResolvedValue([
        { kind: "audiooutput", deviceId: "speakers", label: "Динамики" },
      ]) },
    });
    vi.stubGlobal("navigator", testNavigator);
    try {
      mockAPI();
      render(<App />);
      const user = await join();
      await screen.findByRole("heading", { name: "Голосовая комната" });
      let completeOutput: (() => void) | undefined;
      sessions[0].setOutputDevice.mockReturnValueOnce(new Promise<void>((resolve) => { completeOutput = resolve; }));
      await user.click(screen.getByRole("button", { name: "Настроить звук" }));
      const output = screen.getByRole("combobox", { name: "Выбрать динамики" });
      await waitFor(() => expect(within(output).getAllByRole("option")).toHaveLength(2));
      await user.selectOptions(output, "speakers");
      await user.click(screen.getByRole("button", { name: "Закрыть настройки" }));
      await user.click(screen.getByRole("switch", { name: "Выключить микрофон" }));
      await act(async () => completeOutput?.());
      await user.click(screen.getByRole("button", { name: "Выйти из разговора" }));
      await user.click(screen.getByRole("button", { name: "Войти снова" }));
      await screen.findByRole("heading", { name: "Голосовая комната" });

      expect(sessions[1].prepareMicrophone).not.toHaveBeenCalled();
      expect(sessions[1].setOutputDevice).toHaveBeenCalledWith("speakers");
    } finally {
      if (originalSink) Object.defineProperty(prototype, "setSinkId", originalSink);
      else Reflect.deleteProperty(prototype, "setSinkId");
    }
  });
});
