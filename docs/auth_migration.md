# Auth & RBAC upgrade rollout

Use these steps when deploying the new authorization/authentication features.

## 1) Dependencies
- Backend: install Google auth library if you plan to enable Google sign-in
  - `pip install google-auth`

## 2) Environment
- Backend env (Django):
  - `GOOGLE_CLIENT_ID=` (required for Google OAuth)
  - Optional GeoIP provider (if you want location in audit logs): `GEOIP_PROVIDER_URL=`, `GEOIP_API_KEY=` (implement in utils if adding)

- Frontend env (`frontend/.env.local`):
  - `VITE_GOOGLE_CLIENT_ID=` (to display Google sign-in button when wired)
  - Keep existing `VITE_API_BASE_URL`, `VITE_WS_BASE_URL`, `VITE_API_PREFIX`, `VITE_WS_PATH` as needed.

## 3) Database migrations
- Apply new migrations:
  - `python manage.py migrate apps.auth_rbac 0002_rbac_expansion`
  - `python manage.py migrate apps.audit 0002_enrich_audit`
- Existing admin users are auto-approved with full access; existing viewers are approved and stay read-only.

## 4) Access model recap
- Roles: administrator, moderator, viewer, guest.
- Approval required for all non-admin accounts; start/expiry supported (guest expiry uses `expires_at`).
- Scoped access via `access_all_agents` plus agent/org assignments.
- Moderators: manage agents/operations/audit read; cannot create/approve users.
- Viewers/guests: read-only; no audit access.

## 5) Audit enrichment
- Audit now captures user agent, device, path/method, session id, and (optionally) approver.
- Location fields are present; fill via a GeoIP provider if desired.

## 6) Testing suggestions
- Backend: exercise login/approval/expiry, role permissions on agents, registration approval (approve/reject), Google token verification (mock), audit log filters.
- Frontend: route guards per role (viewer/guest cannot see audit or controls), registration approval UI, org CRUD, scoped user creation, unauthorized/404 pages.
