# Dotnote

**Your notes. Your cloud. Your AI key.**

Dotnote is a local-first markdown notes app that runs in **your own Cloudflare account**. Your notes are plain `.md` files in your R2 bucket — no notes cloud operated by us, no per-seat subscription, no proprietary vault format.

> Dotnote is **source-available** under the [Sustainable Use License 1.0](./LICENSE.md) (fair-code, not OSI open source). Personal and internal company use is free. See [License](#license) below and [docs/license-faq.md](./docs/license-faq.md).

## Quick start

### Option A — Guided install (recommended)

1. Go to [dotnote.cloud](https://dotnote.cloud) and start the install.
2. Sign in with Cloudflare (OAuth) and follow the wizard. It creates the Worker, D1 database, and R2 bucket in **your** account.
3. Open your new Dotnote URL and create the owner account. The first account becomes the owner of that deployment.
4. Start writing. Your notes sync to your R2 bucket automatically.

No server to maintain. A typical install fits comfortably in Cloudflare's free tier; Cloudflare bills your account directly if you ever exceed it.

### Option B — Deploy from source

Use this if you want to run a modified build or deploy without the guided installer.

Prerequisites:

- Node.js 22.13+
- pnpm 9.12+ (`corepack enable`)
- A Cloudflare account and [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (installed as a dev dependency)

```bash
pnpm install

# Create the resources in your Cloudflare account
pnpm --filter dotnote-app exec wrangler d1 create dotnote-index
pnpm --filter dotnote-app exec wrangler r2 bucket create dotnote-data

# Configure the app worker with your resource IDs
cp app/wrangler.example.jsonc app/wrangler.jsonc
# Edit app/wrangler.jsonc: set database_id, worker name, and vars.

# Apply database migrations and deploy
pnpm --filter dotnote-app exec wrangler d1 migrations apply dotnote-index --remote
pnpm deploy:app
```

Open the deployed Worker URL and create the owner account.

Notes on configuration (`app/wrangler.jsonc`):

| Setting | Meaning |
|---|---|
| `d1_databases[0].database_id` | Your `dotnote-index` D1 database ID |
| `r2_buckets[0].bucket_name` | Your notes bucket (default `dotnote-data`) |
| `vars.WORKER_NAME` | Name of your deployed Worker |
| `vars.DOTNOTE_DIAGNOSTICS_ENABLED` | `true` lets this deployment register with Dotnote Cloud after the owner opts in. `false` or omitted sends nothing. See [docs/diagnostics.md](./docs/diagnostics.md). |
| `vars.DOTNOTE_DIAGNOSTICS_URL` | Where a registration is sent. Ignored unless diagnostics are enabled and the token secret is set. |
| Secret `DOTNOTE_DIAGNOSTICS_TOKEN` | Bearer token for that endpoint. The guided installer sets it. A source deploy without this secret never registers. |
| `vars.INSTALLER_ORIGIN` | Origin of the install site used for reconnect links |

Running the **installer** yourself is optional and advanced: it needs its own D1 database and a Cloudflare OAuth client ID (`installer/wrangler.example.jsonc`). Most people should use the guided install at dotnote.cloud instead.

## Using Dotnote

### Workspaces, folders, and notes

- Organize work into **workspaces**, each with its own folder tree.
- Click `+` (or a folder's add button) to create a note instantly. A note's title comes from its first `# Heading` and updates everywhere — sidebar, tabs, search — as you type.
- Notes are stored as standard markdown (`.md`) files. You can read them directly in your R2 bucket at any time.

### Editor and tabs

- Block-based editor with markdown underneath: what you save is a plain `.md` file, not a proprietary block database.
- VS Code-style tabs: single-click opens a **preview** tab, double-click or editing makes it permanent. Drag to reorder; tab sessions survive reloads.
- Autosave is automatic (about 400 ms after you stop typing). There is no save button to forget.

### Search

- Press **⌘K** (macOS) or **Ctrl+K** (Windows/Linux) for full-text search across titles, folders, paths, and note bodies.
- With an empty query, ⌘K shows your recent notes.
- Search runs locally in a background worker against your own notes — queries are not sent to a search server.

### Offline and sync

- Dotnote is local-first: edits are saved in your browser immediately and synced in the background, even if the connection drops. Work offline and everything catches up when you reconnect.
- Sidebar and tab markers show each note's state: **local** (not on the server yet) and **syncing**.
- If the same note was changed somewhere else, Dotnote stops and asks you to choose **Keep mine** or **Use server copy** instead of silently overwriting.

### Version history

- Dotnote keeps up to 100 timestamped snapshots per note in your R2 bucket.
- Open a note's history to inspect an older version and restore it. Snapshots live in your account, under `history/` in the same bucket as your notes.

### Sharing

- You can create a public share link for an individual note. Anyone with the link can read that note until you revoke the link.
- Revoke links from the same share dialog. Treat share links like passwords.

### Importing notes

- Import existing `.md` files (including folders of them) into a workspace. Imported files become normal Dotnote notes in your bucket.

### AI (bring your own key)

AI is optional and off until you add a key.

1. Open **Settings → AI** in your deployment.
2. Add an API key for Anthropic, OpenAI, xAI, or Google, and pick a model.
3. Press **⌘J** (or Ctrl+J) or use **Ask AI** in the editor.

Requests go from **your Worker** directly to the provider you chose, using your key. We do not proxy, resell, or log your prompts. Keys are stored in your deployment's database; the browser only ever sees masked fragments. Don't enable AI on confidential notes unless you accept the provider's terms.

## Your data

| What | Where it lives |
|---|---|
| Note `.md` files and version history | Your R2 bucket |
| Workspace index, sessions, AI key storage | Your D1 database |
| Drafts and offline edit queue | Your browser (IndexedDB) |

- We do not operate a notes cloud and do not receive your note titles, folders, or bodies. See the [Privacy Policy](https://dotnote.cloud/privacy).
- **Backups are yours to keep.** Your bucket is the source of truth; export or copy the `.md` files from R2 whenever you like.
- To uninstall, delete the Worker, D1 database, and R2 bucket from your Cloudflare account. Deleting the bucket permanently deletes your notes unless you kept a copy.

## Updating

- **Guided install:** when a new version is out, the sidebar offers it. Dotnote applies the new database migrations and replaces its own Worker using the Cloudflare permission it stored at install, then the page reloads. You never sign in to Cloudflare again for an update. **Settings › Updates** shows the running version, checks on demand, can go back to the version you updated from, and can install new releases on its own every 30 minutes, even with no tab open (off by default). Releases are signed, and Dotnote refuses one that is not. See [docs/self-update.md](./docs/self-update.md).
- **Deployed with wrangler:** run the guided installer once for the same Worker (repair keeps your notes). It hands the Worker the same Cloudflare permission a guided install has, and it updates itself from then on. Or keep updating from source as below.
- **From source:** pull the new source, then re-run the deploy:

```bash
pnpm install
pnpm --filter dotnote-app exec wrangler d1 migrations apply dotnote-index --remote
pnpm deploy:app
```

Your notes are not touched by redeploying the Worker.

## Local development

```bash
pnpm install
cp app/wrangler.example.jsonc app/wrangler.jsonc
pnpm dev
```

This starts the app worker and frontend together:

| Service | URL |
|---|---|
| Frontend (Vite) | http://127.0.0.1:39220 |
| App worker (API) | http://127.0.0.1:8787 |

Optional: run the guided-install worker locally:

```bash
pnpm dev:installer   # installer worker on http://127.0.0.1:8789
```

The dotnote.cloud marketing and install site is maintained in the private **dotnote-ops** repository, not in this tree.

Local D1 migrations are applied automatically by the dev scripts. Local data stays in Wrangler's local storage and never touches your production bucket.

## Repository layout

| Path | What it is |
|---|---|
| `app/` | The Dotnote web app and its Cloudflare Worker API |
| `installer/` | The guided-install worker (Cloudflare OAuth → deploy into a user's account) |
| `scripts/pack-release.mjs` | Builds the release the installer deploys and running Dotnotes update to |
| `docs/` | User and license documentation |

Architecture notes for contributors are in [docs/local-first.md](./docs/local-first.md).

## Contributing

Bug reports and pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first — contributions require a signed Contributor License Agreement, because Dotnote is also offered under separate commercial licenses.

## License

Dotnote is licensed under the **Sustainable Use License 1.0** — see [LICENSE.md](./LICENSE.md). In plain terms:

- ✅ Use it personally, or inside your own company, for free — including modifying it for those purposes.
- ✅ Redistribute it free of charge for non-commercial purposes, with license and copyright notices intact.
- ❌ No offering Dotnote (or a product built mainly on it) to third parties commercially — hosted, white-labeled, resold, or as a paid deployment service — without a separate commercial license.
- The Dotnote name and logo are trademarks; see [TRADEMARKS.md](./TRADEMARKS.md).

Full plain-language FAQ: [docs/license-faq.md](./docs/license-faq.md). Commercial licensing and support: **support@dotnote.cloud**.

Your notes and other content you create are yours; the license covers the software, not your content.

Third-party components keep their own licenses (including fonts under the SIL Open Font License 1.1).
