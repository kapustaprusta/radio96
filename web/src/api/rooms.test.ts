import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, createRoom, getRoom, joinRoom } from "./rooms";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRoom", () => {
  it("creates a room without sending secret data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          roomId: "room-id",
          inviteUrl: `/rooms/${"A".repeat(32)}`,
          expiresAt: "2026-09-04T10:00:00Z",
          maxParticipants: 8,
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createRoom()).resolves.toMatchObject({ roomId: "room-id", maxParticipants: 8 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/rooms",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it.each([
    { name: "non-object", body: [] },
    { name: "missing room id", body: { inviteUrl: "/rooms/value", expiresAt: "now", maxParticipants: 8 } },
    {
      name: "unexpected participant limit",
      body: { roomId: "id", inviteUrl: "/rooms/value", expiresAt: "now", maxParticipants: 9 },
    },
  ])("rejects a malformed $name response", async ({ body }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body, 201)));

    await expect(createRoom()).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("getRoom", () => {
  it.each(["open", "active", "finished", "expired"] as const)("accepts %s status", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status, expiresAt: "2026-09-04T10:00:00Z" }, 200)),
    );

    await expect(getRoom("A".repeat(32))).resolves.toEqual({
      status,
      expiresAt: "2026-09-04T10:00:00Z",
    });
  });

  it("uses the stable API error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ code: "room_not_found", message: "raw backend text" }, 404)),
    );

    const request = getRoom("A".repeat(32));
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({ code: "room_not_found", status: 404 });
  });
});

describe("joinRoom", () => {
  const credentials = { serverUrl: "wss://voice.example", participantToken: "opaque-token", participantIdentity: "identity" };

  it("uses an abortable POST with generated request shape for both listener and microphone sessions", async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse(credentials, 200));
    vi.stubGlobal("fetch", request);
    const controller = new AbortController();
    await expect(joinRoom("A".repeat(32), "Влад 🎮", controller.signal)).resolves.toEqual(credentials);
    expect(request).toHaveBeenCalledWith(`/api/v1/rooms/${"A".repeat(32)}/join`, expect.objectContaining({
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Влад 🎮" }), signal: controller.signal,
      cache: "no-store", referrerPolicy: "no-referrer",
    }));
  });

  it.each([
    { name: "empty token", patch: { participantToken: "" } },
    { name: "empty identity", patch: { participantIdentity: "" } },
    { name: "non-websocket URL", patch: { serverUrl: "https://voice.example" } },
    { name: "malformed URL", patch: { serverUrl: "not a URL" } },
    { name: "URL with embedded credentials", patch: { serverUrl: "wss://name:secret@voice.example" } },
  ])("rejects $name without leaking the credentials in the error", async ({ patch }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...credentials, ...patch }, 200)));
    await expect(joinRoom("A".repeat(32), "Влад")).rejects.toMatchObject({
      code: "invalid_response", message: "radio96 API request failed",
    });
  });
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
