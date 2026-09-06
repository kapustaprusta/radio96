import { describe, expect, it } from "vitest";

import { parseRoute, sameOriginRoomPath } from "./routing";

const inviteCode = "Aa0".repeat(10) + "Z9";

describe("parseRoute", () => {
  it.each([
    { pathname: "/", expected: { kind: "home" } },
    { pathname: `/rooms/${inviteCode}`, expected: { kind: "room", inviteCode } },
    { pathname: "/rooms/short", expected: { kind: "not-found" } },
    { pathname: `/rooms/${inviteCode}/`, expected: { kind: "not-found" } },
    { pathname: `/rooms/${"!".repeat(32)}`, expected: { kind: "not-found" } },
    { pathname: `/rooms/${"A".repeat(31)}`, expected: { kind: "not-found" } },
    { pathname: `/rooms/${"A".repeat(33)}`, expected: { kind: "not-found" } },
    { pathname: `/rooms/${"A".repeat(43)}`, expected: { kind: "not-found" } },
    { pathname: `/rooms/${"A".repeat(31)}-`, expected: { kind: "not-found" } },
    { pathname: `/rooms/${"A".repeat(31)}_`, expected: { kind: "not-found" } },
    { pathname: `/rooms/${"A".repeat(31)}я`, expected: { kind: "not-found" } },
    { pathname: `/rooms/${inviteCode}\n`, expected: { kind: "not-found" } },
    { pathname: "/settings", expected: { kind: "not-found" } },
  ])("parses $pathname", ({ pathname, expected }) => {
    expect(parseRoute(pathname)).toEqual(expected);
  });
});

describe("sameOriginRoomPath", () => {
  it.each([
    { name: "relative contract URL", url: `/rooms/${inviteCode}`, expected: `/rooms/${inviteCode}` },
    {
      name: "absolute same-origin URL",
      url: `https://radio96.test/rooms/${inviteCode}`,
      expected: `/rooms/${inviteCode}`,
    },
    { name: "cross-origin URL", url: `https://evil.test/rooms/${inviteCode}`, expected: null },
    { name: "room URL with query", url: `/rooms/${inviteCode}?source=test`, expected: null },
    { name: "non-room URL", url: "/", expected: null },
    { name: "legacy invite", url: `/rooms/${"A".repeat(43)}`, expected: null },
    { name: "non-alphanumeric invite", url: `/rooms/${"A".repeat(31)}_`, expected: null },
    { name: "invalid URL", url: "https://[", expected: null },
  ])("handles $name", ({ url, expected }) => {
    expect(sameOriginRoomPath(url, "https://radio96.test")).toBe(expected);
  });
});
