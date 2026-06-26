# Vercel Deployment Guide

Deploy the ATLAS frontend to Vercel using the static build pipeline defined in `vercel.json`.

## Prerequisites
- Vercel account with access to the target Git repository.
- Node.js 20 LTS available locally (matches the project’s expectation).
- Environment variable values for the backend API (`VITE_API_BASE_URL`, `VITE_API_PREFIX`, etc.).

## One-Time Setup
1. **Push the latest code** to the remote branch you plan to deploy.
2. **Import the repository** at [https://vercel.com/new](https://vercel.com/new).
3. When prompted for project settings:
   - **Framework Preset:** `Other` (the project uses Vite).
   - **Root Directory:** `frontend`.
   - **Build Command:** `npm run build` (Vercel runs `npm install` automatically).
   - **Install Command:** leave as `npm install` unless you need a custom registry.
   - **Output Directory:** `dist`.
4. Save the project; Vercel will detect `vercel.json` at the repo root and apply its SPA routing rules automatically.

## Environment Variables
Navigate to **Project Settings → Environment Variables** and add the values required by the frontend:

| Variable | Description | Example |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Origin of the REST API | `https://api.example.com` |
| `VITE_API_PREFIX` | REST path prefix (default `/api/v1`) | `/api/v1` |
| `VITE_WS_BASE_URL` | WebSocket origin (optional; falls back to API host) | `wss://api.example.com` |
| `VITE_WS_PATH` | WebSocket path (default `/ws/subscribe/`) | `/ws/subscribe/` |
| `VITE_ATLAS_AI_ENABLED` | Enable ATLAS-AI UI (`true`/`false`) | `false` |

Create each variable for the **Production** environment. Duplicate them for other environments (Preview, Development) if needed.

## Deploy
1. Trigger a deployment by pushing to the connected branch (or click **Deploy** in the Vercel dashboard).
2. Vercel will execute `npm install` and `npm run build` inside the `frontend` directory and publish the contents of `dist`.
3. After the build completes, open the preview URL to verify the app renders correctly and API calls reach your backend.

## Troubleshooting
- **Blank page / 404 on refresh:** `vercel.json` includes a SPA fallback route that rewrites unknown paths to `index.html`. Ensure the file remains at the repository root.
- **API requests failing:** confirm the `VITE_API_BASE_URL` (and related variables) point to a reachable backend that allows the Vercel domain via CORS.
- **Environment variable updates:** redeploy the site after changing variables; Vercel rebuilds with the new values.

## Optional Enhancements
- Configure **Custom Domains** under Project Settings → Domains.
- Enable **Password Protection** or **Deploy Hooks** for custom workflows.
- Add monitoring via Vercel Analytics or integrate your preferred tooling.
