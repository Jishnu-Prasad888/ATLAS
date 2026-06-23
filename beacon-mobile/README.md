# Beacon Mobile

Mobile companion for the Beacon observability platform, built with Expo and React Native.

## Key Features

- Dashboard, metrics, logs, health, and operations overviews tailored for handheld devices.
- AI Analyst chat experience backed by the Commander endpoint.
- AI Workbench for on-device graph execution experiments.
- Organizations and reports management with role-aware access control.
- Full parity with web roles (administrator, moderator, viewer, guest) including approval gating.

## Development

```bash
npm install
expo start
```

The Expo Dev Tools will guide you through launching on iOS, Android, or web. For TypeScript checks run:

```bash
npx tsc --noEmit
```

## Environment

- API base url, prefix, and websocket options can be adjusted inside the app settings screen.
- Authentication tokens are stored securely via Expo Secure Store.
