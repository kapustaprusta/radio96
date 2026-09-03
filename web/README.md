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

## Checks

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

`npm run check` runs the complete frontend verification sequence.
