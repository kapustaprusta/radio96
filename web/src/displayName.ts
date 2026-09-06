export type DisplayNameError = "empty" | "too-long";

export type DisplayNameValidation =
  | { valid: true; value: string }
  | { valid: false; error: DisplayNameError };

export function validateDisplayName(value: string): DisplayNameValidation {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return { valid: false, error: "empty" };
  }

  if (Array.from(normalized).length > 32) {
    return { valid: false, error: "too-long" };
  }

  return { valid: true, value: normalized };
}
