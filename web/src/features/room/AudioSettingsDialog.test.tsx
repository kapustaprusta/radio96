import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { playTestTone } from "./audioDeviceTests";
import { AudioSettingsDialog } from "./AudioSettingsDialog";

vi.mock("./audioDeviceTests", () => ({ playTestTone: vi.fn() }));

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
  vi.mocked(playTestTone).mockReset();
  const testNavigator = Object.create(navigator) as Navigator;
  Object.defineProperty(testNavigator, "mediaDevices", { value: { enumerateDevices, getUserMedia } });
  Object.defineProperty(testNavigator, "permissions", { value: undefined });
  vi.stubGlobal("navigator", testNavigator);
});

describe("audio test controls", () => {
  let originalSink: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalSink = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "setSinkId");
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    if (originalSink) Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", originalSink);
    else Reflect.deleteProperty(HTMLMediaElement.prototype, "setSinkId");
  });

  it.each(["stop", "microphone", "close"])("stops the speaker waveform and playback on %s", async (action) => {
    const stop = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal("AudioContext", class {
      createAnalyser = () => ({ fftSize: 256, getByteTimeDomainData: (data: Uint8Array) => data.fill(128) });
      createMediaStreamSource = () => ({ connect: vi.fn() });
      resume = vi.fn().mockResolvedValue(undefined);
      close = close;
    });
    vi.mocked(playTestTone).mockImplementation((_deviceId, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("", "AbortError")), { once: true });
    }));
    const { unmount } = renderSettings(true);
    const user = userEvent.setup();
    const microphonePanel = screen.getByText("Микрофон").closest("section")!;
    const speakerPanel = screen.getByText("Динамики").closest("section")!;
    await user.click(within(speakerPanel).getByRole("button", { name: "Проверить" }));
    expect(screen.getByRole("img", { name: "Тестовый звук" })).toBeInTheDocument();
    const signal = vi.mocked(playTestTone).mock.calls[0][1];

    if (action === "stop") await user.click(within(speakerPanel).getByRole("button", { name: "Остановить" }));
    if (action === "close") unmount();
    if (action === "microphone") {
      await user.click(within(microphonePanel).getByRole("button", { name: "Проверить" }));
      expect(await screen.findByRole("meter", { name: "Уровень микрофона" })).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.queryByRole("img", { name: "Тестовый звук" })).not.toBeInTheDocument());
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    if (action === "microphone") {
      await user.click(within(speakerPanel).getByRole("button", { name: "Проверить" }));
      expect(screen.queryByRole("meter")).not.toBeInTheDocument();
      expect(stop).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      expect(within(microphonePanel).getByRole("button", { name: "Проверить" })).toBeEnabled();
      unmount();
      expect(vi.mocked(playTestTone).mock.calls[1][1].aborted).toBe(true);
    }
  });
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
  it.each([
    { granted: false, label: "Нет доступа к микрофону" },
    { granted: true, label: "Микрофон по умолчанию" },
  ])("shows the microphone field for permission granted=$granted", async ({ granted, label }) => {
    renderSettings(granted);
    const select = screen.getByRole("combobox", { name: "Выбрать микрофон" });
    expect(select).toHaveTextContent(label);
    if (granted) expect(select).toBeEnabled();
    else {
      expect(select).toBeDisabled();
      await userEvent.setup().click(select);
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Разрешить доступ" })).toBeEnabled();
    }
    expect(screen.queryByText("Разреши доступ к микрофону", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Без него друзья не услышат тебя")).not.toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("requests permission explicitly, releases its probe and applies input choices", async () => {
    const stop = vi.fn();
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    renderSettings();
    const user = userEvent.setup();
    const select = screen.getByRole("combobox", { name: "Выбрать микрофон" });
    expect(select).toBeDisabled();
    expect(select).toHaveTextContent("Нет доступа к микрофону");
    expect(screen.queryByRole("button", { name: "Проверить" })).not.toBeInTheDocument();
    enumerateDevices.mockResolvedValue(devices);
    await user.click(screen.getByRole("button", { name: "Разрешить доступ" }));
    expect(await screen.findByText("Доступ разрешён")).toBeInTheDocument();
    expect(select).toBeEnabled();
    expect(select).toHaveTextContent("Микрофон по умолчанию");
    expect(screen.queryByText("Нет доступа к микрофону")).not.toBeInTheDocument();
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
    expect(screen.getByRole("combobox", { name: "Выбрать микрофон" })).toHaveTextContent("Нет доступа к микрофону");
    expect(screen.queryByText("sensitive device details")).not.toBeInTheDocument();
  });

  it("stops a permission stream that arrives after the dialog was closed", async () => {
    const stop = vi.fn();
    let completePermission: ((stream: unknown) => void) | undefined;
    getUserMedia.mockReturnValue(new Promise((resolve) => { completePermission = resolve; }));
    const { unmount } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Разрешить доступ" }));
    expect(screen.getByRole("combobox", { name: "Выбрать микрофон" })).toHaveTextContent("Нет доступа к микрофону");
    expect(screen.getByRole("button", { name: "Запрашиваем доступ…" })).toBeDisabled();
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
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "Гарнитура" }));
    expect(onInputChange).toHaveBeenCalledWith({ deviceId: "headset", label: "Гарнитура" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(select).toHaveFocus();
    await user.click(select);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Готово" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Закрыть настройки" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the real device label while a permitted input change is pending", async () => {
    enumerateDevices.mockResolvedValue(devices);
    let complete: (() => void) | undefined;
    const onInputChange = vi.fn().mockReturnValue(new Promise<void>((resolve) => { complete = resolve; }));
    render(<AudioSettingsDialog selectedInput={selectedInput} selectedOutputId="default" microphoneGranted
      onInputChange={onInputChange} onOutputChange={vi.fn()} onClose={vi.fn()} />);
    const user = userEvent.setup();
    const select = screen.getByRole("combobox", { name: "Выбрать микрофон" });
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "Гарнитура" }));
    expect(select).toBeDisabled();
    expect(select).toHaveTextContent("Микрофон по умолчанию");
    expect(screen.queryByText("Нет доступа к микрофону")).not.toBeInTheDocument();
    await act(async () => complete?.());
    expect(select).toBeEnabled();
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
      await user.click(select);
      await user.click(await screen.findByRole("option", { name: "Динамики" }));
      expect(select).toBeDisabled();
      await user.click(select);
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(onOutputChange).toHaveBeenCalledOnce();
      await act(async () => complete?.());
      expect(select).toBeEnabled();
    } finally {
      if (originalSink) Object.defineProperty(prototype, "setSinkId", originalSink);
      else Reflect.deleteProperty(prototype, "setSinkId");
    }
  });
});
