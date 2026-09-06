import { describe, expect, it } from "vitest";

import { validateDisplayName } from "./displayName";

describe("validateDisplayName", () => {
  it.each([
    { name: "empty", input: "", error: "empty" },
    { name: "whitespace only", input: " \n\t ", error: "empty" },
    { name: "33 Cyrillic code points", input: "я".repeat(33), error: "too-long" },
    { name: "33 emoji code points", input: "🎮".repeat(33), error: "too-long" },
  ])("rejects $name", ({ input, error }) => {
    expect(validateDisplayName(input)).toEqual({ valid: false, error });
  });

  it.each([
    { name: "one character", input: "Я", expected: "Я" },
    { name: "trimmed nickname", input: "  Влад  ", expected: "Влад" },
    { name: "32 Cyrillic code points", input: "я".repeat(32), expected: "я".repeat(32) },
    { name: "32 emoji code points", input: "🎮".repeat(32), expected: "🎮".repeat(32) },
  ])("accepts $name", ({ input, expected }) => {
    expect(validateDisplayName(input)).toEqual({ valid: true, value: expected });
  });
});
