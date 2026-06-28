# Beacon Frontend

Beacon is the web dashboard for the ATLAS observability platform. It is a React + TypeScript application built with Vite, Tailwind, TanStack Query, and Zustand. The project now ships with production-focused defaults: runtime configuration loading, manifest output, and hardened proxy settings for local development.

## Prerequisites

- Node.js ≥ 20 (18 works, but 20+ matches the deployment images)
- npm ≥ 9 (bundled with Node 20)

## Getting Started

```bash
cd frontend
npm install
cp .env.example .env.local   # customise as needed
npm run dev
```

The Vite dev server listens on `http://localhost:5173` by default and proxies API/WebSocket traffic to the backend specified in `.env.local` (see **Configuration**). Hot module reloading and React refresh are enabled out of the box.

## Configuration

### Build-time vs runtime values

Most settings can be provided either at build time (via `.env*` files or CI environment variables) or at runtime using `app-config.json`:

- `public/app-config.example.json` illustrates the runtime format. Copy it to your deployment, rename to `app-config.json`, and make it available at the web root (`/app-config.json`). The app fetches this file before mounting and merges it with the build-time defaults.
- If your hosting platform injects configuration via script, expose `window.__BEACON_CONFIG__` before `src/main.tsx` runs (for example by templating `index.html`). The runtime loader will honour that object and skip the JSON fetch.

When neither a script nor JSON file is available, the compile-time `.env` values are used.

### Key environment variables

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | REST API origin (e.g. `https://beacon.example.com`) |
| `VITE_WS_BASE_URL` | WebSocket origin (e.g. `wss://beacon.example.com`) |
| `VITE_API_PREFIX` | API prefix, defaults to `/api/v1` |
| `VITE_WS_PATH` | WebSocket path, defaults to `/ws/subscribe/` |
| `VITE_ATLAS_AI_ENABLED` | Toggle the ATLAS-AI panel |
| `VITE_DEV_PROXY_TARGET` | (Dev only) alternate HTTP proxy target |
| `VITE_DEV_PROXY_WS_TARGET` | (Dev only) alternate WS proxy target |
| `VITE_HEALTH_PATH` | Path proxied to the backend health endpoint |
| `VITE_DEBUG_HTTP`, `VITE_DEBUG_WS` | Enable verbose HTTP / WS logging |

Refer to `.env.example` for the complete list, including AI provider settings.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server with proxying and HMR |
| `npm run dev:poll` | Same as above but forces polling (for WSL/VM) |
| `npm run build` | Type-check (`tsc -b`) and produce an optimized build in `dist/` with a Rollup manifest |
| `npm run preview` | Serve the production build locally with the same proxy rules |
| `npm run lint` | Run ESLint over the source tree |
| `npm run test` | Execute Vitest in watch mode |
| `npm run test:coverage` | Generate coverage reports |

## Build & Deploy

1. Ensure your runtime configuration is available (see **Configuration**).
2. Run `npm run build` – output is generated in `frontend/dist/`.
3. Deploy the `dist/` directory to a static host or CDN.
4. Serve an `app-config.js` or `app-config.json` alongside the assets so the app can discover the backend URLs at runtime. This can be done with a small render step in your container image or via your web server (e.g. Nginx serving a templated file).

Because the build emits a Rollup manifest (`dist/manifest.json`), it can be consumed by backend frameworks that need hashed asset filenames.

## Directory Overview

- `src/` – Application source code
  - `api/` – Axios client and resource wrappers
  - `components/` – Reusable UI building blocks
  - `pages/` – Route-level views
  - `store/` – Zustand stores for global state
  - `ws/` – WebSocket client abstraction
- `public/` – Static assets bundled verbatim (favicons, config examples)

## Debugging

Set `VITE_DEBUG_HTTP=true` or `VITE_DEBUG_WS=true` (via `.env.local` or runtime config) to re-enable verbose logging in production. Without these flags, request/response traces stay silent outside `npm run dev`.

## Testing Notes

- Vitest runs in a JSDOM environment and boots the setup script in `src/test/setup.ts`.
- All CSS imported in tests is processed; no manual mocking required.

## Troubleshooting

- **Proxy misrouting in dev** – double-check `VITE_DEV_PROXY_TARGET`, `VITE_API_PREFIX`, and `VITE_WS_PATH`. The Vite config normalises slashes, but the backend must expose matching paths.
- **Runtime config not loading** – confirm `/app-config.js` or `/app-config.json` is reachable from the deployed host before `index.html` is cached.
