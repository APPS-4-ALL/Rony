# Invoice Scanner (Rony)

> Free, open-source local-first desktop app to scan, download, and manage invoices and receipts directly from your Gmail.

Rony connects to your **Gmail API**, automatically parses financial documents using deterministic rules or advanced AI, and downloads them locally to your machine — all displayed in a centralized management dashboard.

---

## ⚠️ Important Disclaimers

**Google "Unverified App" screen:** During OAuth sign-in, you will see a Google warning that this app is unverified. This is normal for self-hosted open-source apps. Click "Advanced → Go to Rony (unsafe)" to continue. No data is sent to external servers — only to Google and your local machine.

**Windows SmartScreen:** The installer is unsigned in the MVP phase. Click "More info → Run anyway" to install.

**AI costs:** If you choose to use the Advanced AI Search route and connect your LLM provider key, usage costs are charged directly to your account by the provider. Rony does not charge anything.

---

## Features

- **Automated Scanning** — Fetches recent emails and detects financial documents automatically.
- **Deterministic Route** — Local text filtering using optimized Regular Expressions (Regex) for keywords like "Invoice", "Receipt", "חשבונית", and "קבלה".
- **Advanced AI Search** — Semantic analysis via LLM to classify financial attachments and extract structured metadata (Vendor, Amount, Date).
- **Local Storage & Privacy** — Downloads attachments and metadata directly to your local machine.
- **Centralized Dashboard** — Beautiful table view to filter, sort, search, and export your financial records.
- **100% Local-First** — No third-party backend servers, no telemetry, your financial data stays strictly on your machine.

---

## Install

Download the latest `.exe` installer from [GitHub Releases](https://github.com/APPS-4-ALL/Rony/releases) and run it.

> Windows SmartScreen will warn you — click "More info → Run anyway". The app is unsigned in MVP (see [disclaimer](#️-important-disclaimers)).

> **Note (MVP):** the build ships no Google credentials, so signing in requires your own OAuth client in the environment — see [Google API credentials](#google-api-credentials-required). In practice that means running from source for now.

---

## Build from Source

**Requirements:** Node.js **≥20.19** (see [`.nvmrc`](.nvmrc) — 20.17 breaks the test runner), npm 9+ (or yarn/pnpm)

```bash
git clone https://github.com/APPS-4-ALL/Rony.git
cd Rony
npm install
npm run dev
```

### Google API credentials (required)

Rony talks to Gmail with **your own** Google OAuth *Desktop* client — it ships
no credentials of its own. Copy [`.env.example`](.env.example) to `.env` and set
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (from a Google Cloud project with the
Gmail API enabled). The app reads them from the environment, so **the packaged
installer only authenticates when those variables are present in the environment
it runs in** — there is no bundled secret. For most users that means running
from source as above.

To build a distributable installer:

```bash
npm run build
```

The installer will be generated in your release directory.

---

## Tech Stack

| Layer          | Choice                                                 |
| -------------- | ------------------------------------------------------ |
| Shell          | Electron (latest stable)                               |
| Build Tool     | electron-vite                                          |
| Language       | TypeScript (strict) / JavaScript                       |
| UI             | Vue 3 (Composition API)                                |
| Styling        | Tailwind CSS                                           |
| Database       | SQLite (via better-sqlite3)                            |
| Google APIs    | google-auth-library (Gmail REST API, OAuth 2.0)        |
| AI Integration | LLM API Client (Structured JSON Outputs)               |

---

## Privacy

Rony collects no telemetry. Your emails, credentials, token files, and downloaded invoices are stored entirely locally on your hard drive.

---

## License

**MIT License + [Commons Clause](https://commonsclause.com/)** — © Elie e.b advisory and computing ltd.

Free to use, audit, fork, modify, and self-host. The Commons Clause adds one
restriction: you may **not sell** the Software (or a product/service whose value
derives substantially from it). See [`LICENSE`](LICENSE) for the full terms.
