import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";

const inviteCode = "A".repeat(32);

describe("home", () => {
  it("creates a room and navigates to its same-origin pre-join", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            roomId: "room-id",
            inviteUrl: `/rooms/${inviteCode}`,
            expiresAt: "2026-09-04T10:00:00Z",
            maxParticipants: 8,
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "open", expiresAt: "2026-09-04T10:00:00Z" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Создать комнату" }));

    expect(await screen.findByRole("heading", { name: "Вход в комнату" })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/rooms/${inviteCode}`);
    expect(document.title).toBe("Голосовая комната — radio96");
    expect(document.title).not.toContain(inviteCode);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("blocks a duplicate create request and restores the action after an error", async () => {
    const user = userEvent.setup();
    let rejectRequest: ((reason: Error) => void) | undefined;
    const pendingRequest = new Promise<Response>((_resolve, reject) => {
      rejectRequest = reject;
    });
    const fetchMock = vi.fn().mockReturnValue(pendingRequest);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const button = screen.getByRole("button", { name: "Создать комнату" });
    await user.dblClick(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    rejectRequest?.(new Error("network unavailable"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось создать комнату");
    expect(screen.getByRole("button", { name: "Попробовать снова" })).toBeEnabled();
  });

  it("rejects a cross-origin invite URL returned by the API", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            roomId: "room-id",
            inviteUrl: `https://example.com/rooms/${inviteCode}`,
            expiresAt: "2026-09-04T10:00:00Z",
            maxParticipants: 8,
          },
          201,
        ),
      ),
    );

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Создать комнату" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось создать комнату");
    expect(window.location.pathname).toBe("/");
  });
});

describe("room gate", () => {
  it.each([
    { status: "open", heading: "Вход в комнату" },
    { status: "active", heading: "Вход в комнату" },
    { status: "expired", heading: "Ссылка больше не действует" },
    { status: "finished", heading: "Разговор уже закончился" },
  ])("renders $status room state", async ({ status, heading }) => {
    window.history.replaceState(null, "", `/rooms/${inviteCode}`);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status, expiresAt: "2026-09-04T10:00:00Z" }, 200)),
    );

    render(<App />);

    expect(screen.getByRole("heading", { name: "Проверяем комнату…" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("maps room_not_found by API code without displaying the backend message", async () => {
    window.history.replaceState(null, "", `/rooms/${inviteCode}`);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ code: "room_not_found", message: "private backend details" }, 404)),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Комната не найдена" })).toBeInTheDocument();
    expect(screen.queryByText("private backend details")).not.toBeInTheDocument();
  });

  it("retries a recoverable room request without parallel calls", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/rooms/${inviteCode}`);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(jsonResponse({ status: "open", expiresAt: "2026-09-04T10:00:00Z" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const retry = await screen.findByRole("button", { name: "Повторить" });
    await user.click(retry);

    expect(await screen.findByRole("heading", { name: "Вход в комнату" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("pre-join", () => {
  it("validates a display name after blur and submit", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/rooms/${inviteCode}`);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status: "open", expiresAt: "2026-09-04T10:00:00Z" }, 200)),
    );

    render(<App />);
    const input = await screen.findByRole("textbox", { name: "Никнейм" });
    await user.click(input);
    await user.tab();

    expect(screen.getByText("Введи никнейм.")).toBeInTheDocument();

    await user.type(input, "  Влад  ");
    await user.click(screen.getByRole("button", { name: "Войти в разговор" }));

    expect(input).toHaveValue("Влад");
    expect(screen.queryByText("Введи никнейм.")).not.toBeInTheDocument();
  });

  it("toggles the microphone and opens audio settings", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/rooms/${inviteCode}`);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status: "open", expiresAt: "2026-09-04T10:00:00Z" }, 200)),
    );

    render(<App />);
    const microphoneSwitch = await screen.findByRole("switch", { name: "Выключить микрофон" });
    await user.click(microphoneSwitch);

    expect(screen.getByText("Микрофон выключен")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Включить микрофон" })).toHaveAttribute("aria-checked", "false");

    await user.click(screen.getByRole("button", { name: "Настроить звук" }));
    expect(screen.getByRole("dialog", { name: "Настройки звука" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Закрыть настройки" }));
    expect(screen.queryByRole("dialog", { name: "Настройки звука" })).not.toBeInTheDocument();
  });

  it("copies only the current full room URL", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    window.history.replaceState(null, "", `/rooms/${inviteCode}`);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status: "open", expiresAt: "2026-09-04T10:00:00Z" }, 200)),
    );

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Копировать ссылку" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    expect(screen.getByRole("status")).toHaveTextContent("Ссылка скопирована");
  });
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
