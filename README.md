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

Download the latest `.exe` installer from [GitHub Releases](https://github.com/shbh8205-lgtm/invoice-scanner-rony/releases) and run it.

> Windows SmartScreen will warn you — click "More info → Run anyway". The app is unsigned in MVP (see [disclaimer](#️-important-disclaimers)).

---

## Build from Source

**Requirements:** Node.js 18+, npm 9+ (or yarn/pnpm)

```bash
git clone [https://github.com/shbh8205-lgtm/invoice-scanner-rony.git](https://github.com/shbh8205-lgtm/invoice-scanner-rony.git)
cd invoice-scanner-rony
npm install
npm run dev
To build a distributable installer:Bashnpm run build
The installer will be generated in your release directory.Tech StackLayerChoiceShellElectron (latest stable)Build Toolelectron-viteLanguageTypeScript (strict) / JavaScriptUIVue 3 (Composition API)StylingTailwind CSSDatabaseSQLite (via better-sqlite3 or native driver)Google APIsgoogleapis + google-auth-library (Gmail API OAuth 2.0)AI IntegrationLLM API Client (Structured JSON Outputs)PrivacyRony collects no telemetry. Your emails, credentials, token files, and downloaded invoices are stored entirely locally on your hard drive.LicenseMIT — free to use, audit, fork, and self-host.
