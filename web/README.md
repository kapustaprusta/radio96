# radio96 web

React + TypeScript client for the radio96 web MVP.

## Local development

Requirements: Node.js 22.12 or newer and npm 10 or newer.

```bash
npm ci
npm run dev
```

The Vite development server proxies `/api` to `http://127.0.0.1:8080`, so run
the Go backend separately on its default address.

When Vite runs in a container and the API runs on the host, set the target at
startup, for example:

```bash
API_PROXY_TARGET=http://host.containers.internal:8080 npm run dev -- --host 0.0.0.0
```

Room URLs and participant credentials are not included in frontend or SDK logs.
Vite proxy failures also omit the requested room URL.

## API contract

`src/api/schema.d.ts` is generated from `../api/openapi.yaml`; do not edit it by
hand. The API boundary in `src/api/rooms.ts` uses these types and validates
responses before passing credentials to the media adapter.

```bash
npm run generate
npm run generate:check
```

Generation uses pinned `openapi-typescript@7.13.0` and `typescript@5.9.3` in an
isolated `npm exec` environment because the generator does not yet support
TypeScript 6 as a peer dependency. The application stays on TypeScript 6. The
first generation needs npm registry access. CI checks that the committed types
match the current schema before checking the frontend.

For a container with `web/` mounted at `/app`, mount `api/` read-only at `/api`.
Alternatively pass a schema path with `npm run generate -- --schema=/path/to/openapi.yaml`.

## Calling flow

Pre-join rechecks the room, asks for microphone permission if selected, obtains a
fresh participant token from the API, and connects through `src/media/session.ts`.
Only `src/media/livekit.ts` depends on raw LiveKit objects. The UI uses its own
participant and connection snapshots.

A denied or missing microphone offers an explicit listener action. Listeners
receive remote audio and can enable the microphone later without reconnecting.
The call screen includes stable participant ordering, speaking/mute indicators,
autoplay recovery, device selection and testing, copy-link fallback, reconnect
feedback, and leave/rejoin actions. Joining times out after 15 seconds of a stalled
network or media connection; a retry always obtains a new token.

Names, chosen devices, and credentials live only in memory for the current tab.
Leaving, navigation, cancellation, and page hiding dispose the media session;
browser back/forward cache restoration returns to pre-join.

The Go backend must have LiveKit Cloud configured for a real call. With local
all-empty LiveKit configuration it can create/check rooms but join returns
`media_unavailable`. Fake media tests verify UI and adapter behavior; they do not
replace a two-browser Cloud call and checks with actual microphones/headphones.

## Checks

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

`npm run check` runs the complete frontend verification sequence.

Tests cover microphone and listener join, denied/missing devices, fresh-token
retries, join timeout, remote audio attachment, participants, reconnect and mute,
track cleanup, device-selection races, and safe API error mapping.
