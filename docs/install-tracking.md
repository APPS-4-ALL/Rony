# RONY-20 — Install tracking (data connection + panel)

Reference spec for Rony's opt-in install counter, **modeled on the Tal desktop
app's data connection** (Tal = a separate local-first Electron app by apps4all
that already does this). Captured here so the contract survives after the Tal
example keys are removed from `.env`.

---

## 1. Tal's contract (the working example we copied from)

Source: `Tal/electron/main/services/license.ts` + `telemetry.ts`.

**Auth + transport**
- Header: `x-tal-secret: <TAL_API_SECRET>`
- `Content-Type: application/json`
- Base URL: `TAL_API_URL` (default `https://apps4all.net`); paths under `/api/tal/...`
- Every call wrapped in `AbortSignal.timeout(...)` and `.catch()` — never throws.
- If `TAL_API_SECRET` is unset, tracking is disabled (logged warn, no calls).

**Install id (this is how Tal counts installs)**
- `randomUUID()` generated once, stored in the SQLite `settings` table under
  key `install_id` (get-or-create). Anonymous, not tied to a person.
- On startup, `POST /api/tal/register` ("upsert — safe to call every time").
  The server upserts by `install_id`, so the count of distinct `install_id`s =
  the number of installs. Each machine is counted once, no matter how many
  times the app is launched.

**Endpoints**
| Method + path            | When            | Body |
|--------------------------|-----------------|------|
| `POST /api/tal/register` | on startup (upsert) | `{ install_id, business_name, owner_name, owner_email, app_version, platform }` |
| `POST /api/tal/heartbeat`| every 5 min     | `{ install_id, app_version, telemetry_opt_in }` |
| `POST /api/tal/logs`     | flush, opt-in only | `{ install_id, app_version, logs: [{ level, message, ts }] }` |

> The **register** call is the install counter. The **heartbeat** is separate —
> it tracks *active sessions*, which Rony does NOT need.

---

## 2. How Rony adapts it (deliberate differences)

Rony's brief: **count installs only, no personal data, opt-in.** So Rony copies
the *transport pattern* but changes the *policy*:

| Aspect        | Tal                                   | Rony |
|---------------|---------------------------------------|------|
| Auth header   | `x-tal-secret`                        | `x-rony-secret` |
| Base / path   | `TAL_API_URL` → `/api/tal/*`          | `RONY_API_URL` → `/api/rony/*` |
| Secret env    | `TAL_API_SECRET`                      | `RONY_API_SECRET` (Rony's OWN — never reuse Tal's) |
| Gating        | register/heartbeat always; logs opt-in| **everything gated** on the `installConsent` toggle |
| Frequency     | heartbeat every 5 min                 | **fire-once** per install (count installs, not runs) |
| PII in body   | sends owner email/name/business       | **none** — only `install_id`, `app_version`, `platform` |
| Consent UI    | "telemetry opt-in"                    | Hebrew: `אני מאשר שידעו שהתקנתי את רוני` (default OFF) |

**Rony ping body (final):**
```json
{ "install_id": "<uuid>", "app_version": "1.0.0", "platform": "win32" }
```
`POST <RONY_API_URL>/api/rony/install` with header `x-rony-secret: <RONY_API_SECRET>`.

---

## 3. Backend + panel — lives in the apps4all Next.js repo (APPS-4-ALL/apps4all)

Verified against the real apps4all source (Tal's implementation):
- Mongo access via `@/lib/mongodb` → `getCollection(name)`, DB **`multiBlogDB`**.
- Tal uses collection `talSessions`; **Rony uses `ronyInstalls`**.
- Route files: `app/api/tal/{register,heartbeat,logs}/route.js`. Each checks
  `process.env.TAL_API_SECRET` against the `x-tal-secret` header, then upserts.
- Panel: `app/tal-admin/page.jsx`, login `app/tal-admin/login/`, login/logout API
  `app/api/tal-admin/login|logout/route.js`, guarded by `middleware.js`
  (cookie `tal_admin_session`, hash of `TAL_ADMIN_PASSWORD` + `NEXTAUTH_SECRET`).

Rony mirror (privacy-minimal — NO PII, NO telemetry/logs):
- **`app/api/rony/install/route.js`** — verify `x-rony-secret` vs
  `RONY_API_SECRET`, `upsert { install_id, app_version, platform }` into
  `ronyInstalls`. Returns `{ ok: true }`.
- **`app/rony-admin/`** panel — install count = `ronyInstalls.countDocuments()`
  + a table (short id, platform, version, first seen). Login + `middleware.js`
  guard using cookie `rony_admin_session` + `RONY_ADMIN_PASSWORD`.

---

## 4. Env vars Rony adds (`.env` / `.env.example`)

```
RONY_API_URL=https://apps4all.net
RONY_API_SECRET=<rony's own secret — generated for Rony, not Tal's>
```
`MONGODB_URI` belongs to the backend project, **not** here.
