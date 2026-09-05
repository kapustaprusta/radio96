export const inviteCodePattern = /^[A-Za-z0-9]{32}$/;

export type AppRoute =
  | { kind: "home" }
  | { kind: "room"; inviteCode: string }
  | { kind: "not-found" };

export function parseRoute(pathname: string): AppRoute {
  if (pathname === "/") {
    return { kind: "home" };
  }

  const match = /^\/rooms\/([^/]+)$/.exec(pathname);
  if (match && match[1].length === 32 && inviteCodePattern.test(match[1])) {
    return { kind: "room", inviteCode: match[1] };
  }

  return { kind: "not-found" };
}

export function sameOriginRoomPath(inviteUrl: string, origin: string): string | null {
  let resolved: URL;

  try {
    resolved = new URL(inviteUrl, origin);
  } catch {
    return null;
  }

  if (resolved.origin !== origin || resolved.search !== "" || resolved.hash !== "") {
    return null;
  }

  return parseRoute(resolved.pathname).kind === "room" ? resolved.pathname : null;
}
