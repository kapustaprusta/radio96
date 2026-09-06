import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "../../components/IconButton";
import { LinkIcon } from "../../components/Icons";
import { FakeMediaSession } from "../../test/fakeMediaSession";
import { AudioTestPanel } from "./AudioTestPanel";
import { CallView } from "./CallView";
import { ConnectionProgress } from "./ConnectionProgress";
import { InviteLinkFeedback } from "./InviteLinkFeedback";
import { defaultJoinPreferences } from "./joinPreferences";
import { participantColor } from "./participantPresentation";
import { RoomError } from "./RoomError";

describe("mockup screen structure", () => {
  it.each([
    { checkingRoom: true, heading: "Проверяем комнату…" },
    { checkingRoom: false, heading: "Подключаемся…" },
  ])("uses the compact loading composition for $heading", ({ checkingRoom, heading }) => {
    render(<ConnectionProgress checkingRoom={checkingRoom} onCancel={vi.fn()} />);
    expect(screen.getByRole("heading", { name: heading }).parentElement).toHaveClass("connection-stack");
    expect(screen.queryByText(/Шаг .* из 3/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отменить" })).toBeEnabled();
  });

  it.each([
    { code: "room_not_found", title: "Комната не найдена", terminal: true },
    { code: "room_expired", title: "Ссылка больше не действует", terminal: true },
    { code: "room_finished", title: "Разговор завершён", terminal: true },
    { code: "room_closed", title: "Разговор завершён", terminal: true },
    { code: "room_full", title: "Комната уже заполнена", terminal: false },
    { code: "connection_failed", title: "Не удалось подключиться", terminal: false },
    { code: "disconnected", title: "Связь прервалась", terminal: false },
  ])("matches terminal actions for $code", async ({ code, title, terminal }) => {
    const navigate = vi.fn();
    const onRetry = vi.fn();
    render(<RoomError code={code} onRetry={onRetry} navigate={navigate} />);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(terminal ? 1 : 2);
    const home = screen.getByRole("button", { name: "На главную" });
    expect(home).toHaveClass(terminal ? "button--primary" : "button--secondary");
    await userEvent.setup().click(home);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/");
    expect(onRetry).not.toHaveBeenCalled();
  });

  it.each([1, 4, 5, 8])("keeps the call with %i participants focused on avatars and four icon controls", (count) => {
    const session = new FakeMediaSession();
    session.snapshot = {
      connection: "connected", audioPlaybackBlocked: false, disconnectReason: null,
      participants: Array.from({ length: count }, (_, index) => ({
        identity: `participant-${index}`, name: `Игрок ${index}`, isLocal: index === 0,
        microphoneEnabled: index !== 1, speaking: index === 1 || index === 2,
      })),
    };
    const { container } = render(<CallView snapshot={session.snapshot} session={session} preferences={defaultJoinPreferences}
      onPreferencesChange={vi.fn()} onLeave={vi.fn()} />);
    expect(screen.getAllByRole("article")).toHaveLength(count);
    expect(container.querySelector(".participant-grid")).toHaveAttribute("data-count", String(count));
    expect(screen.getByRole("heading", { name: "Голосовая комната" }).parentElement).toHaveClass("sr-only");
    expect(container.querySelector(".participant__status")).not.toBeInTheDocument();
    expect(container.querySelector(".solo-invite")).not.toBeInTheDocument();
    const controls = container.querySelector(".call-controls")! as HTMLElement;
    for (const button of Array.from(controls.children)) expect(button).toHaveClass("button--icon");
    expect(controls.children).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Выйти из разговора" })).not.toHaveClass("button--danger");
    expect(participantColor("local", true)).toBe("light-dark(#a6aca4, #737a74)");
    if (count > 1) expect(screen.getByRole("article", { name: "Игрок 1, Микрофон выключен" }))
      .toHaveAttribute("data-speaking", "false");
  });
});

describe("mockup feedback", () => {
  it.each(["button", "Escape"])("returns from clipboard fallback with %s and restores focus", async (action) => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<><button type="button">Копировать</button>
      <InviteLinkFeedback copyState="idle" onDismiss={onDismiss} /></>);
    const trigger = screen.getByRole("button", { name: "Копировать" });
    trigger.focus();
    rerender(<><button type="button">Копировать</button><InviteLinkFeedback copyState="fallback" onDismiss={onDismiss} /></>);
    const dialog = screen.getByRole("dialog", { name: "Буфер обмена недоступен" });
    const input = within(dialog).getByRole("textbox", { name: "Ссылка на комнату" });
    expect(input).toHaveValue(window.location.href);
    expect(input).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Вернуться" })).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    if (action === "button") await user.click(within(dialog).getByRole("button", { name: "Вернуться" }));
    else await user.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledOnce();
    rerender(<><button type="button">Копировать</button><InviteLinkFeedback copyState="idle" onDismiss={onDismiss} /></>);
    expect(trigger).toHaveFocus();
  });

  it("shows a real tooltip on keyboard focus and dismisses it on Escape", async () => {
    render(<IconButton tooltip="Копировать ссылку" aria-label="Копировать ссылку"><LinkIcon /></IconButton>);
    const user = userEvent.setup();
    await user.tab();
    const button = screen.getByRole("button", { name: "Копировать ссылку" });
    expect(button).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it.each([0, 35, 100])("renders the wave from measured input level %i", (level) => {
    const { rerender } = render(<AudioTestPanel level={level} />);
    const meter = screen.getByRole("meter", { name: "Уровень микрофона" });
    expect(meter).toHaveAttribute("aria-valuenow", String(level));
    expect(meter.children).toHaveLength(28);
    expect(screen.getByText("Слушаем")).toBeInTheDocument();
    rerender(<AudioTestPanel />);
    expect(screen.getByRole("img", { name: "Тестовый звук" })).toBeInTheDocument();
    expect(screen.getByText("Играет")).toBeInTheDocument();
  });
});
