import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Brand } from "./Brand";
import {
  AlertIcon, CheckIcon, ChevronDownIcon, ClipboardOffIcon, ClockIcon, CloseIcon, LinkIcon,
  LogOutIcon, MicIcon, MicOffIcon, PhoneOffIcon, PlayIcon, RadioIcon, SearchIcon,
  SettingsIcon, ShareIcon, StopIcon, UnplugIcon, UsersIcon, VolumeIcon,
} from "./Icons";

const icons = [
  ["alert", AlertIcon], ["check", CheckIcon], ["chevron", ChevronDownIcon],
  ["clipboard", ClipboardOffIcon], ["clock", ClockIcon], ["close", CloseIcon],
  ["link", LinkIcon], ["log out", LogOutIcon], ["microphone", MicIcon],
  ["microphone off", MicOffIcon], ["phone off", PhoneOffIcon], ["play", PlayIcon],
  ["radio", RadioIcon], ["search", SearchIcon], ["settings", SettingsIcon],
  ["share", ShareIcon], ["stop", StopIcon], ["unplug", UnplugIcon],
  ["users", UsersIcon], ["volume", VolumeIcon],
] as const;

describe("icon rendering", () => {
  it.each(icons)("renders %s as a consistently sized inline SVG", (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("height", "24");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("fill", "none");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("stroke-linecap", "round");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the brand mark as one SVG instead of subpixel CSS bars", () => {
    render(<Brand navigate={vi.fn()} />);
    const mark = screen.getByRole("link", { name: "radio96 — на главную" }).querySelector("svg.brand__mark");
    expect(mark).toHaveAttribute("viewBox", "0 0 28 28");
    expect(mark?.querySelectorAll("rect")).toHaveLength(10);
    expect(mark?.querySelectorAll("i")).toHaveLength(0);
  });
});
