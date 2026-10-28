# Self-update

A Dotnote updates itself. The "worker" here is the user's **Cloudflare Worker script**, not a Service Worker. Nothing new is installed for this: the app Worker uses a Cloudflare credential it was given once — the permission it stored at install (`cf_grant`, renewed with `mintAccessToken()`), or an API token the owner stored on it (see [Credentials](#credentials)) — fetches the newest signed release from the installer, applies its migrations to its own D1, uploads its files, and replaces its own script. No one signs in to Cloudflare again for an update. The sidebar banner and **Settings › Updates** only show what the Worker is doing; with [automatic updates](#automatic-updates) on, a Cron Trigger runs it with no tab open.

```
sidebar (updateStore)        Dotnote Worker (old)          installer           Cloudflare API     Dotnote Worker (new)
  GET /api/update/check  ──▶  GET /release/manifest.json ──▶ (15 min cache)
  POST /api/update/start ──▶  insert update_jobs row
  POST /api/update/step  ──▶  prepare · migrate · assets · upload · deploy ─────────▶ PUT script
  POST /api/update/step  ──────────────────────────────────────────────────────────────────────▶ verify ✓
  location.reload()
```

## Versions

- **Worker:** `BUILD_VERSION` (`app/worker/update/version.ts`) is read from `app/package.json` at bundle time, so it is right however the Worker was deployed. The installer and the updater also bind `APP_VERSION` so the Cloudflare dashboard shows it.
- **Page:** `vite.config.ts` injects the same version as `VITE_APP_VERSION` (`src/lib/app-version.ts`). When the Worker reports a different version than the page, the page offers a reload.

## Releases

`scripts/pack-release.mjs` writes `installer/public/release/`:

| Path | What |
|---|---|
| `manifest.json` | Latest release, manifest schema 2 |
| `manifest.json.sig` | Ed25519 signature over the exact bytes of `manifest.json` (see [Signed releases](#signed-releases)) |
| `worker.js` | Latest Worker bundle |
| `files/<hash>` | Static assets, content-addressed and shared across releases |
| `archive/<version>/manifest.json`, `.sig`, `worker.js` | Every kept release, for pinned downloads and rollback |
| `archive/index.json` | Kept releases, newest first |

Schema 2 adds `releasedAt`, `notes` (from `release-notes/<version>.md`), `rolloutPercent`, `autoUpdate`, `workerSha256`, `sizeBytes`, and groups `migrations` per file with the release that first shipped it (`{ name, since, statements }`). `migrationsFlat` keeps the schema 1 statement list. The directory is gitignored and accumulates on the machine that releases; packing on a fresh checkout starts the archive over.

Release notes front matter. `rollout` is optional: the percent of instances offered the release, default 100. `auto` is optional: `false` keeps automatic updates from starting this release, so every owner starts it themselves (use it for a release that asks something of them).

```markdown
---
date: 2026-11-01
rollout: 25
auto: false
---
```

The rollout bucket is a stable hash of the account and Worker name, so widening the percentage keeps the instances that already had it.

## Migrations

The updater keeps `schema_migrations(name, applied_at)` in the app's D1, created with `CREATE TABLE IF NOT EXISTS` by the updater itself (and by the installer on fresh installs), never by a migration. On update it applies a file when its `@since` is newer than the running version **and** it is not recorded. That skips files from before tracking existed and files wrangler already applied. Each file runs in one D1 batch together with its `schema_migrations` row, so it lands completely or not at all.

Migrations run before the new code is uploaded, so they must only add and must be safe to run twice. See CONTRIBUTING.md.

## The job

`update_jobs` holds one row per update or rollback. The browser drives it one step per `POST /api/update/step`, like the installer, so no request hits the subrequest or time limits; any open tab can drive it, the cron run drives it when no tab does, and a lease keeps it to one request at a time. Each step is saved before the next.

| Step | Does | Installer counterpart |
|---|---|---|
| `prepare` | Load the target manifest, list pending migrations, mint a token and read the script's settings, so a revoked permission fails before the database changes | `check` (resources already exist) |
| `migrate` | Pending files, up to five per request, through the app's own `DB` binding | `migrate` |
| `assets` | Open an asset upload session for the release's files | `assets` |
| `upload` | One bucket of files per request; each file's SHA-256 must match its name in the signed manifest | `assets` |
| `deploy` | Download `worker.js` and check its hash, then `PUT` the script with the current bindings (from the settings API), a fresh `APP_VERSION`, and `keep_bindings` for secrets. Missing secrets (including `CF_API_TOKEN`) are put back from the old Worker's env, and the update Cron Trigger is added if the Worker has none | `worker`, `secrets` |
| `verify` | Passes only when answered by the new code: D1 and R2 probes, then `app_meta.version` | `prove` |

`d1`, `r2`, `secrets` and `address` are not repeated. The updater never generates a new `CF_GRANT_KEY`: a new key could not decrypt the stored grant.

If the old version still answers 90 seconds after the upload, the job fails with `unverified` and the banner offers **Check again**. Failed jobs resume from their step (an upload or deploy restarts the upload, whose token expires). **Dismiss** cancels a failed job so the release is offered fresh. A request that dies mid-step is retried; after three in a row the job fails.

## Who can update

`GET /api/update/check` reports `canUpdate`, a `blockedReason`, and the `credential` in use (`grant`, `token`, or none). The rules are in `app/worker/update/policy.ts`:

| Reason | Meaning |
|---|---|
| `development` | `DOTNOTE_DEV=1`: never redeploy from local dev |
| `no_installer` | No `INSTALLER_ORIGIN`, so there is nowhere to fetch releases from |
| `unconfigured` | No API token, and no `WORKER_NAME`, OAuth client id, or grant key: deployed with wrangler. Store an API token once to fix it |
| `not_connected` | No API token and no stored Cloudflare grant: an install whose handoff never landed. Finish it from the installer, reconnect, or store an API token |
| `missing_scopes` | The grant lacks `workers-scripts.read` or `workers-scripts.write`. The banner offers **Reconnect** |

`/api/update/*` stays behind the Dotnote login. "No sign-in" means no Cloudflare sign-in per update, never an open endpoint: whoever can call these routes can replace the Worker.

The page will not start an update while it has unsynced changes or an import is running. The cron run cannot see the browser, so it does not wait for that; queued edits sync to the new version afterwards.

## Credentials

The Worker needs one credential that can replace its own script. It is given once and kept; every update after that runs on it.

**Installer grant.** The installer deploys the Worker with `CF_GRANT_KEY` (AES-GCM key, secret) and `CF_OAUTH_CLIENT_ID`. The browser that ran the install then proves the new Worker answers (`/api/install/prove`) and hands it the OAuth refresh token directly (`/api/install/handoff`); the installer never holds it. The Worker exchanges it at once, so the browser's copy stops working, and keeps the rotated refresh token encrypted in `cf_grant`.

The handoff is what finishes an install. Until it lands, the installer keeps the installation row (status `ready`) and lists it as unfinished:

- **Continue** in the browser that started it, or **Continue here** in any other: `POST /api/installations/:id/resume` (Cloudflare access to the account is enough, like **Remove**) issues a new browser key and puts a new `DOTNOTE_HANDOFF` hash on the Worker, so the new browser's setup code is the one accepted.
- The Worker records which `DOTNOTE_HANDOFF` hash it consumed (`install_state.handoff_done`). A new hash from **Continue here**, an installer update, or a repair hands over once more. A consumed code is ignored only while a readable grant exists, so a stuck install can always finish.
- Installer **update** and **repair** add a `CF_GRANT_KEY` only when the Worker's secret list lacks one (a wrangler deploy): replacing an existing key would make the stored grant undecryptable. They also add `WORKER_NAME`, `CF_ACCOUNT_ID`, `CF_OAUTH_CLIENT_ID`, and `INSTALLER_ORIGIN` when the Worker lacks them, and keep the existing values otherwise.

**API token.** For a Dotnote deployed with wrangler, or one whose grant is gone, the owner pastes a Cloudflare API token with **Account › Workers Scripts › Edit** in **Settings › Cloudflare** (`POST /api/cloudflare/token`, `app/worker/update/api-token.ts`). The Worker checks that the token opens a script with its name in an account the token can see, and that the script's D1 and R2 bindings and plain-text vars match its own env (and the `workers.dev` host, if it has one), so it lands on this Dotnote and not another. Then the token stores itself on that script as the `CF_API_TOKEN` secret; the account id and Worker name go to `app_meta`. The Worker keeps no other copy and never returns it. Cloudflare redeploys the Worker to add the secret; the page waits until a request sees it. **Remove token** deletes the secret with the token itself. A stored token wins over a grant. Wrangler users can also run `wrangler secret put CF_API_TOKEN`; the Worker then uses `CF_ACCOUNT_ID` and `WORKER_NAME` from its vars.

## Automatic updates

Off by default. **Settings › Updates › Install new releases on their own** (`POST /api/update/auto`) needs `canUpdate`, puts the update Cron Trigger (`*/30 * * * *`, `app/worker/update/cron.ts`) on the Worker next to any it already has, and sets `app_meta.auto_update`. The installer adds the same trigger at install, the updater adds it after each upload when the Worker lacks it, and wrangler deploys take it from `triggers` in `wrangler.jsonc`.

Every run (`scheduled` in `app/worker/index.ts` → `app/worker/update/schedule.ts`):

1. Drives a job that is still running, whoever started it, so an update a closed tab left behind finishes.
2. Otherwise, with automatic updates on, starts an update to the latest release unless it is blocked, not newer, marked `auto: false`, held by its rollout, or already tried: an update to it failed or was dismissed, or this Dotnote went back from it (`triedBefore` in `jobs.ts`). The owner can still start those by hand.
3. Runs steps for up to five minutes. It stops at `verify`, which only the new code can pass; the next run is answered by the new code and finishes the job. Open tabs see a version change and offer a reload.

A run that hits the plan's CPU limit midway is retried like any interrupted step: the next run resumes it, and three interruptions in a row fail the job.

## Signed releases

With automatic updates nobody looks at a release before an instance runs it, so the installer origin alone is not trusted. `scripts/pack-release.mjs` signs each `manifest.json` (and every kept archive) with Ed25519 into `manifest.json.sig`: `{ "keyId": "…", "signature": "<base64>" }` over the exact bytes served. The Worker (`release-client.ts`, `signature.ts`) reads nothing from a manifest whose signature does not verify against a key in `app/worker/update/release-keys.json`, which is bundled into the Worker. Through the signed manifest it then trusts `workerSha256` for the Worker bundle and each file's SHA-256 prefix for the static assets. The cached copy keeps the signature and is checked again on every read.

The private key lives with whoever releases, never in a repository. `node scripts/release-key.mjs` creates `~/.dotnote/release-signing-key.pem` (or reads an existing one) and adds its public half to `release-keys.json`; `pack-release` reads it from `DOTNOTE_RELEASE_SIGNING_KEY` (PEM), `DOTNOTE_RELEASE_SIGNING_KEY_FILE`, or that default path, and refuses to pack with a key the list does not hold. To rotate, add the new key, ship a release signed with the old one, then sign with the new one; drop the old entry a release later. A fork that runs its own installer creates its own key the same way.

## Rollback

**Settings › Cloudflare › Go back to x.y.z** runs the same job toward the version this Dotnote updated itself from, using its archived manifest. It runs no migrations; tables added by the newer version stay. There is no automatic rollback: a failure alone does not tell code problems from data problems.

## Compatibility rules

- `update_jobs`, `schema_migrations` and `app_meta` columns may be added, never renamed: an older Worker reads them after a rollback.
- The `/api/update/*` responses must stay readable by the previous version's page, which drives the job until it reloads.
- A release that needs a new binding must create it in the updater (and the installer) or treat it as optional. The updater only carries over the bindings the script already has.
- Dotnotes installed before self-update existed (0.1.0) have no updater. They need one redeploy to a release that has it.
- Releases before 0.2.4 do not check signatures and have no `scheduled` handler. Going back to one leaves the Cron Trigger in place; its runs fail harmlessly until the next update.
