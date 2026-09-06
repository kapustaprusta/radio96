import type { components } from "./schema";

const roomStatuses = new Set(["open", "active", "finished", "expired"] as const);

export type RoomStatus = components["schemas"]["RoomStatus"];
export type CreateRoomResponse = components["schemas"]["CreateRoomResponse"];
export type RoomResponse = components["schemas"]["RoomResponse"];
export type JoinRoomResponse = components["schemas"]["JoinRoomResponse"];

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super("radio96 API request failed");
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export async function createRoom(signal?: AbortSignal): Promise<CreateRoomResponse> {
  const response = await fetch("/api/v1/rooms", {
    method: "POST",
    headers: { Accept: "application/json" },
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal,
  });

  const payload = await parseResponse(response);
  if (!response.ok) {
    throw apiErrorFrom(payload, response.status);
  }

  if (!isRecord(payload)) {
    throw new ApiError("invalid_response", response.status);
  }

  const { roomId, inviteUrl, expiresAt, maxParticipants } = payload;
  if (
    typeof roomId !== "string" ||
    roomId.length === 0 ||
    typeof inviteUrl !== "string" ||
    typeof expiresAt !== "string" ||
    maxParticipants !== 8
  ) {
    throw new ApiError("invalid_response", response.status);
  }

  return { roomId, inviteUrl, expiresAt, maxParticipants };
}

export async function getRoom(inviteCode: string, signal?: AbortSignal): Promise<RoomResponse> {
  const response = await fetch(`/api/v1/rooms/${encodeURIComponent(inviteCode)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal,
  });

  const payload = await parseResponse(response);
  if (!response.ok) {
    throw apiErrorFrom(payload, response.status);
  }

  if (!isRecord(payload)) {
    throw new ApiError("invalid_response", response.status);
  }

  const { status, expiresAt } = payload;
  if (
    typeof status !== "string" ||
    !isRoomStatus(status) ||
    typeof expiresAt !== "string"
  ) {
    throw new ApiError("invalid_response", response.status);
  }

  return { status, expiresAt };
}

export async function joinRoom(
  inviteCode: string,
  displayName: string,
  signal?: AbortSignal,
): Promise<JoinRoomResponse> {
  const body: components["schemas"]["JoinRoomRequest"] = { displayName };
  const response = await fetch(`/api/v1/rooms/${encodeURIComponent(inviteCode)}/join`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    cache: "no-store",
    referrerPolicy: "no-referrer",
    body: JSON.stringify(body),
    signal,
  });
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw apiErrorFrom(payload, response.status);
  }

  if (!isRecord(payload)) {
    throw new ApiError("invalid_response", response.status);
  }

  const { serverUrl, participantToken, participantIdentity } = payload;
  if (
    typeof serverUrl !== "string" ||
    !isWebSocketURL(serverUrl) ||
    typeof participantToken !== "string" ||
    participantToken.length === 0 ||
    typeof participantIdentity !== "string" ||
    participantIdentity.length === 0
  ) {
    throw new ApiError("invalid_response", response.status);
  }

  return { serverUrl, participantToken, participantIdentity };
}

function isWebSocketURL(value: string): boolean {
  try {
    const url = new URL(value);
    return ["wss:", "ws:"].includes(url.protocol) && url.hostname !== "" && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiErrorFrom(payload: unknown, status: number): ApiError {
  if (isRecord(payload) && typeof payload.code === "string" && payload.code.length > 0) {
    return new ApiError(payload.code, status);
  }

  return new ApiError("unknown_error", status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRoomStatus(value: string): value is RoomStatus {
  return roomStatuses.has(value as RoomStatus);
}
