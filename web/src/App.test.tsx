import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("brand navigation", () => {
  it.each([
    { part: "icon", selector: ".brand__mark" },
    { part: "wordmark", selector: ".brand__wordmark" },
  ])("returns home when clicking the $part", async ({ selector }) => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/rooms/${inviteCode}`);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status: "open", expiresAt: "2026-09-04T10:00:00Z" }, 200)),
    );

    render(<App />);
    await screen.findByRole("heading", { name: "Вход в комнату" });
    const link = screen.getByRole("link", { name: "radio96 — на главную" });
    expect(link).toHaveAttribute("href", "/");
    await user.click(link.querySelector<HTMLElement>(selector)!);

    expect(screen.getByRole("heading", { name: "Голосовой чат для игры с друзьями" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    expect(document.title).toBe("radio96");
  });

  it("returns home from a missing page using the keyboard", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/missing");
    render(<App />);

    await user.tab();
    expect(screen.getByRole("link", { name: "radio96 — на главную" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("heading", { name: "Голосовой чат для игры с друзьями" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it.each([
    { name: "Ctrl-click", modifiers: { ctrlKey: true } },
    { name: "Cmd-click", modifiers: { metaKey: true } },
    { name: "Shift-click", modifiers: { shiftKey: true } },
    { name: "Alt-click", modifiers: { altKey: true } },
    { name: "middle-click", modifiers: { button: 1 } },
  ])("preserves native navigation for $name", ({ modifiers }) => {
    window.history.replaceState(null, "", "/missing");
    render(<App />);
    const nativeNavigation = vi.fn((event: Event) => {
      expect(event.defaultPrevented).toBe(false);
      // JSDOM cannot navigate; cancel the browser default after React handles the click.
      event.preventDefault();
    });
    window.addEventListener("click", nativeNavigation, { once: true });

    fireEvent.click(screen.getByRole("link", { name: "radio96 — на главную" }), modifiers);

    expect(nativeNavigation).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/missing");
    expect(screen.getByRole("heading", { name: "Такой страницы нет" })).toBeInTheDocument();
  });
});

describe("room gate", () => {
  it.each([
    { status: "open", heading: "Вход в комнату" },
    { status: "active", heading: "Вход в комнату" },
    { status: "expired", heading: "Ссылка больше не действует" },
    { status: "finished", heading: "Разговор завершён" },
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
  it.each([
    { name: "empty", value: "" },
    { name: "whitespace-only", value: "   " },
  ])("keeps $name nickname neutral before submitting", async ({ value }) => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/rooms/${inviteCode}`);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status: "open", expiresAt: "2026-09-04T10:00:00Z" }, 200)),
    );

    render(<App />);
    const input = await screen.findByRole("textbox", { name: "Никнейм" });
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    await user.click(input);
    if (value) await user.type(input, value);
    await user.tab();

    expect(input).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Введи никнейм.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Выключить микрофон" }));
    await user.click(screen.getByRole("button", { name: "Настроить звук" }));
    await user.click(screen.getByRole("button", { name: "Закрыть настройки" }));

    expect(input).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Введи никнейм.")).not.toBeInTheDocument();
  });

  it.each([
    { name: "empty nickname via join button", value: "", action: "button" },
    { name: "whitespace-only nickname via join button", value: "   ", action: "button" },
    { name: "empty nickname via Enter", value: "", action: "keyboard" },
    { name: "empty nickname in listener mode", value: "", action: "listener" },
  ])("rejects $name only on submit and clears the error on edit", async ({ value, action }) => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/rooms/${inviteCode}`);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "open", expiresAt: "2026-09-04T10:00:00Z" }, 200));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const input = await screen.findByRole("textbox", { name: "Никнейм" });
    if (value) await user.type(input, value);

    if (action === "keyboard") {
      await user.click(input);
      await user.keyboard("{Enter}");
    } else {
      if (action === "listener") await user.click(screen.getByRole("switch", { name: "Выключить микрофон" }));
      await user.click(screen.getByRole("button", {
        name: action === "listener" ? "Войти без микрофона" : "Войти в разговор",
      }));
    }

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Введи никнейм.");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.type(input, "Влад");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    await user.clear(input);
    await user.tab();

    expect(input).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Введи никнейм.")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "click after button submit", value: "", submit: "button", focus: "click" },
    { name: "click after Enter in the focused input", value: "", submit: "keyboard", focus: "click" },
    { name: "keyboard focus after button submit", value: "", submit: "button", focus: "keyboard" },
    { name: "click with whitespace-only input", value: "   ", submit: "button", focus: "click" },
  ])("dismisses the empty-name error on $name without editing", async ({ value, submit, focus }) => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/rooms/${inviteCode}`);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "open", expiresAt: "2026-09-04T10:00:00Z" }, 200));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const input = await screen.findByRole("textbox", { name: "Никнейм" });
    if (value) await user.type(input, value);
    if (submit === "keyboard") await user.keyboard("{Enter}");
    else await user.click(screen.getByRole("button", { name: "Войти в разговор" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Введи никнейм.");
    expect(input).toHaveAttribute("aria-invalid", "true");

    if (focus === "keyboard") {
      await user.tab({ shift: true });
      await user.tab({ shift: true });
    } else await user.click(input);

    expect(input).toHaveFocus();
    expect(input).toHaveValue(value);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "display-name-hint");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Введи никнейм.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "trimmed nickname", value: "  Влад  ", expected: "Влад", invalid: false },
    { name: "32 Unicode characters", value: "🎮".repeat(32), expected: "🎮".repeat(32), invalid: false },
    { name: "33 Unicode characters", value: "🎮".repeat(33), expected: "🎮".repeat(33), invalid: true },
  ])("preserves blur validation for $name", async ({ value, expected, invalid }) => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/rooms/${inviteCode}`);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status: "open", expiresAt: "2026-09-04T10:00:00Z" }, 200)),
    );
    render(<App />);
    const input = await screen.findByRole("textbox", { name: "Никнейм" });

    await user.type(input, value);
    await user.tab();
    await user.click(input);

    expect(input).toHaveValue(expected);
    if (invalid) {
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toHaveTextContent("Не больше 32 символов.");
    } else {
      expect(input).not.toHaveAttribute("aria-invalid", "true");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
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
