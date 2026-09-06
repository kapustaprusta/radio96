import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DeviceSelect } from "./DeviceSelect";

const options = [
  { deviceId: "default", label: "Микрофон по умолчанию" },
  { deviceId: "headset", label: "Гарнитура" },
  { deviceId: "usb", label: "USB микрофон" },
];

function renderSelect(value = "default", disabled = false) {
  const onChange = vi.fn();
  const result = render(<DeviceSelect id="microphone" label="Выбрать микрофон"
    value={value} options={options} disabled={disabled} onChange={onChange} />);
  return { ...result, onChange, trigger: screen.getByRole("combobox", { name: "Выбрать микрофон" }) };
}

describe("device dropdown", () => {
  it.each([
    { disabled: true, disabledLabel: "Нет доступа к микрофону", expected: "Нет доступа к микрофону" },
    { disabled: false, disabledLabel: "Нет доступа к микрофону", expected: "Гарнитура" },
    { disabled: true, disabledLabel: undefined, expected: "Гарнитура" },
  ])("renders $expected with disabled=$disabled", ({ disabled, disabledLabel, expected }) => {
    render(<DeviceSelect id="microphone" label="Выбрать микрофон" value="headset" options={options}
      disabled={disabled} disabledLabel={disabledLabel} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Выбрать микрофон" })).toHaveTextContent(expected);
  });

  it("shows the real selection, applies a choice and returns focus to the trigger", async () => {
    const { onChange, trigger, rerender } = renderSelect("headset");
    const user = userEvent.setup();
    expect(trigger).toHaveTextContent("Гарнитура");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByRole("option", { name: "Гарнитура" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "USB микрофон" })).toHaveAttribute("aria-selected", "false");
    await user.click(screen.getByRole("option", { name: "USB микрофон" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("usb");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent("Гарнитура");

    rerender(<DeviceSelect id="microphone" label="Выбрать микрофон" value="usb" options={options} onChange={onChange} />);
    expect(trigger).toHaveTextContent("USB микрофон");
  });

  it.each([
    { action: "Enter and arrows", keys: "{Enter}{ArrowDown}{Enter}", choice: "headset" },
    { action: "Space and End", keys: " {End} ", choice: "usb" },
    { action: "ArrowDown and End", keys: "{ArrowDown}{End}{Enter}", choice: "usb" },
    { action: "ArrowUp and Home", keys: "{ArrowUp}{End}{Home}{ArrowDown}{Enter}", choice: "headset" },
    { action: "upper boundary", keys: "{Home}{ArrowUp}{ArrowDown}{Enter}", choice: "headset" },
    { action: "lower boundary", keys: "{End}{ArrowDown}{Enter}", choice: "usb" },
    { action: "Russian typeahead", keys: "гар{Enter}", choice: "headset" },
    { action: "Latin typeahead", keys: "usb{Enter}", choice: "usb" },
  ])("supports $action without applying intermediate choices", async ({ keys, choice }) => {
    const { onChange, trigger } = renderSelect();
    const user = userEvent.setup();
    trigger.focus();
    await user.keyboard(keys);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(choice);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it.each([
    { action: "Escape", close: async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}") },
    { action: "Tab", close: async (user: ReturnType<typeof userEvent.setup>) => user.tab() },
    { action: "outside click", close: async (user: ReturnType<typeof userEvent.setup>) => user.click(document.body) },
    { action: "trigger click", close: async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("combobox")) },
  ])("dismisses on $action without changing the device", async ({ close }) => {
    const { onChange, trigger } = renderSelect();
    const user = userEvent.setup();
    await user.click(trigger);
    await user.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Гарнитура" }).id);
    expect(onChange).not.toHaveBeenCalled();
    await close(user);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps only one device list open and skips options in the Tab order", async () => {
    render(<>
      <DeviceSelect id="microphone" label="Микрофон" value="default" options={options} onChange={vi.fn()} />
      <DeviceSelect id="speakers" label="Динамики" value="default" options={options} onChange={vi.fn()} />
      <button type="button">Готово</button>
    </>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Микрофон" }));
    await user.click(screen.getByRole("combobox", { name: "Динамики" }));
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    expect(screen.getByRole("listbox", { name: "Динамики" })).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("button", { name: "Готово" })).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not open when disabled or reapply the already selected device", async () => {
    const { onChange, trigger, rerender } = renderSelect("default", true);
    const user = userEvent.setup();
    await user.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    rerender(<DeviceSelect id="microphone" label="Выбрать микрофон"
      value="default" options={options} onChange={onChange} />);
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Микрофон по умолчанию" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it.each([
    { position: "below", top: 80, bottom: 126, height: 240 },
    { position: "above", top: 400, bottom: 446, height: 240 },
    { position: "below", top: 160, bottom: 206, height: 219 },
  ])("fits a scrollable menu $position inside the dialog at $top", async ({ position, top, bottom, height }) => {
    const { trigger } = renderSelect();
    const user = userEvent.setup();
    const root = trigger.parentElement!;
    const rootBounds = vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top, bottom } as DOMRect);
    const dialogBounds = vi.spyOn(root, "closest").mockReturnValue({
      getBoundingClientRect: () => ({ top: 40, bottom: 440 }),
    } as unknown as Element);
    try {
      await user.click(trigger);
      expect(screen.getByRole("listbox")).toHaveAttribute("data-placement", position);
      expect(screen.getByRole("listbox")).toHaveStyle({ maxHeight: `${height}px` });
      fireEvent.resize(window);
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    } finally {
      rootBounds.mockRestore();
      dialogBounds.mockRestore();
    }
  });
});
