import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AudioSettingsDialog } from "./AudioSettingsDialog";

const selectedInput = { deviceId: "default", label: "Микрофон по умолчанию" };
const devices = [
  { kind: "audioinput", deviceId: "headset", label: "Гарнитура" },
  { kind: "audioinput", deviceId: "usb", label: "USB микрофон" },
];
const enumerateDevices = vi.fn();
const getUserMedia = vi.fn();

beforeEach(() => {
  enumerateDevices.mockReset().mockResolvedValue([]);
  getUserMedia.mockReset();
  const testNavigator = Object.create(navigator) as Navigator;
  Object.defineProperty(testNavigator, "mediaDevices", { value: { enumerateDevices, getUserMedia } });
  Object.defineProperty(testNavigator, "permissions", { value: undefined });
  vi.stubGlobal("navigator", testNavigator);
});

function renderSettings(microphoneGranted = false) {
  const onInputChange = vi.fn();
  const onClose = vi.fn();
  const result = render(<AudioSettingsDialog
    selectedInput={selectedInput} selectedOutputId="default" microphoneGranted={microphoneGranted}
    onInputChange={onInputChange} onOutputChange={vi.fn()} onClose={onClose}
  />);
  return { ...result, onInputChange, onClose };
}

describe("audio settings", () => {
  it("requests permission explicitly, releases its probe and applies input choices", async () => {
    const stop = vi.fn();
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    renderSettings();
    const user = userEvent.setup();
    expect(screen.getByRole("combobox", { name: "Выбрать микрофон" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Проверить" })).not.toBeInTheDocument();
    enumerateDevices.mockResolvedValue(devices);
    await user.click(screen.getByRole("button", { name: "Разрешить доступ" }));
    expect(await screen.findByText("Доступ разрешён")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalled();
  });

  it.each([
    { reason: "NotAllowedError", text: "Разреши доступ к микрофону в настройках браузера." },
    { reason: "NotFoundError", text: "Микрофон не найден. Подключи устройство." },
  ])("keeps a permission retry action after $reason", async ({ reason, text }) => {
    getUserMedia.mockRejectedValue(new DOMException("sensitive device details", reason));
    renderSettings();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Разрешить доступ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByRole("button", { name: "Разрешить доступ" })).toBeEnabled();
    expect(screen.queryByText("sensitive device details")).not.toBeInTheDocument();
  });

  it("stops a permission stream that arrives after the dialog was closed", async () => {
    const stop = vi.fn();
    let completePermission: ((stream: unknown) => void) | undefined;
    getUserMedia.mockReturnValue(new Promise((resolve) => { completePermission = resolve; }));
    const { unmount } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Разрешить доступ" }));
    unmount();
    await act(async () => completePermission?.({ getTracks: () => [{ stop }] }));
    expect(stop).toHaveBeenCalledOnce();
  });

  it("stops an acquired stream immediately on close while device enumeration is pending", async () => {
    const stop = vi.fn();
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    enumerateDevices.mockResolvedValueOnce([]).mockReturnValue(new Promise(() => undefined));
    const { unmount } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Разрешить доступ" }));
    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(2));
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("measures a microphone only during a manual test and cleans up on close", async () => {
    const stop = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal("AudioContext", class {
      createAnalyser = () => ({ fftSize: 256, getByteTimeDomainData: (data: Uint8Array) => data.fill(150) });
      createMediaStreamSource = () => ({ connect: vi.fn() });
      resume = vi.fn().mockResolvedValue(undefined);
      close = close;
    });
    const { unmount } = renderSettings(true);
    const user = userEvent.setup();
    expect(getUserMedia).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Проверить" }));
    expect(await screen.findByRole("button", { name: "Остановить" })).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Уровень микрофона" })).toBeInTheDocument();
    expect(stop).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("applies a selected input and returns keyboard focus within the dialog", async () => {
    enumerateDevices.mockResolvedValue(devices);
    const { onInputChange, onClose } = renderSettings(true);
    const user = userEvent.setup();
    const select = screen.getByRole("combobox", { name: "Выбрать микрофон" });
    await waitFor(() => expect(screen.getByRole("option", { name: "Гарнитура" })).toBeInTheDocument());
    await user.selectOptions(select, "headset");
    expect(onInputChange).toHaveBeenCalledWith({ deviceId: "headset", label: "Гарнитура" });
    screen.getByRole("button", { name: "Готово" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Закрыть настройки" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blocks another speaker selection until the selected output is applied", async () => {
    const prototype = HTMLMediaElement.prototype;
    const originalSink = Object.getOwnPropertyDescriptor(prototype, "setSinkId");
    Object.defineProperty(prototype, "setSinkId", { configurable: true, value: vi.fn() });
    enumerateDevices.mockResolvedValue([
      { kind: "audiooutput", deviceId: "speakers", label: "Динамики" },
      { kind: "audiooutput", deviceId: "headphones", label: "Наушники" },
    ]);
    let complete: (() => void) | undefined;
    const onOutputChange = vi.fn().mockReturnValue(new Promise<void>((resolve) => { complete = resolve; }));
    try {
      render(<AudioSettingsDialog selectedInput={selectedInput} selectedOutputId="default"
        onInputChange={vi.fn()} onOutputChange={onOutputChange} onClose={vi.fn()} />);
      const user = userEvent.setup();
      const select = screen.getByRole("combobox", { name: "Выбрать динамики" });
      await screen.findByRole("option", { name: "Динамики" });
      await user.selectOptions(select, "speakers");
      expect(select).toBeDisabled();
      await user.selectOptions(select, "headphones");
      expect(onOutputChange).toHaveBeenCalledOnce();
      await act(async () => complete?.());
      expect(select).toBeEnabled();
    } finally {
      if (originalSink) Object.defineProperty(prototype, "setSinkId", originalSink);
      else Reflect.deleteProperty(prototype, "setSinkId");
    }
  });
});
