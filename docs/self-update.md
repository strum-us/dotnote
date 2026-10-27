# Self-update

A Dotnote deployed by the installer updates itself. The "worker" here is the user's **Cloudflare Worker script**, not a Service Worker. Nothing new is installed for this: the app Worker uses the Cloudflare permission it stored at install (`cf_grant`, renewed with `mintAccessToken()`), fetches the newest release from the installer, applies its migrations to its own D1, uploads its files, and replaces its own script. The sidebar banner and **Settings › Cloudflare** only show what the Worker is doing.

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
| `worker.js` | Latest Worker bundle |
| `files/<hash>` | Static assets, content-addressed and shared across releases |
| `archive/<version>/manifest.json`, `worker.js` | Every kept release, for pinned downloads and rollback |
| `archive/index.json` | Kept releases, newest first |

Schema 2 adds `releasedAt`, `notes` (from `release-notes/<version>.md`), `rolloutPercent`, `workerSha256`, `sizeBytes`, and groups `migrations` per file with the release that first shipped it (`{ name, since, statements }`). `migrationsFlat` keeps the schema 1 statement list. The directory is gitignored and accumulates on the machine that releases; packing on a fresh checkout starts the archive over.

Release notes front matter (`rollout` is optional: the percent of instances offered the release, default 100):

```markdown
---
date: 2026-11-01
rollout: 25
---
```

The rollout bucket is a stable hash of the account and Worker name, so widening the percentage keeps the instances that already had it.

## Migrations

The updater keeps `schema_migrations(name, applied_at)` in the app's D1, created with `CREATE TABLE IF NOT EXISTS` by the updater itself (and by the installer on fresh installs), never by a migration. On update it applies a file when its `@since` is newer than the running version **and** it is not recorded. That skips files from before tracking existed and files wrangler already applied. Each file runs in one D1 batch together with its `schema_migrations` row, so it lands completely or not at all.

Migrations run before the new code is uploaded, so they must only add and must be safe to run twice. See CONTRIBUTING.md.

## The job

`update_jobs` holds one row per update or rollback. The browser drives it one step per `POST /api/update/step`, like the installer, so no request hits the subrequest or time limits; any open tab can drive it, and a lease keeps it to one request at a time. Each step is saved before the next.

| Step | Does | Installer counterpart |
|---|---|---|
| `prepare` | Load the target manifest, list pending migrations, mint a token and read the script's settings, so a revoked permission fails before the database changes | `check` (resources already exist) |
| `migrate` | Pending files, up to five per request, through the app's own `DB` binding | `migrate` |
| `assets` | Open an asset upload session for the release's files | `assets` |
| `upload` | One bucket of files per request | `assets` |
| `deploy` | Download `worker.js` and check its hash, then `PUT` the script with the current bindings (from the settings API), a fresh `APP_VERSION`, and `keep_bindings` for secrets. Missing secrets are put back from the old Worker's env | `worker`, `secrets` |
| `verify` | Passes only when answered by the new code: D1 and R2 probes, then `app_meta.version` | `prove` |

`d1`, `r2`, `secrets` and `address` are not repeated. The updater never generates a new `CF_GRANT_KEY`: a new key could not decrypt the stored grant.

If the old version still answers 90 seconds after the upload, the job fails with `unverified` and the banner offers **Check again**. Failed jobs resume from their step (an upload or deploy restarts the upload, whose token expires). **Dismiss** cancels a failed job so the release is offered fresh. A request that dies mid-step is retried; after three in a row the job fails.

## Who can update

`GET /api/update/check` reports `canUpdate` and a `blockedReason`:

| Reason | Meaning |
|---|---|
| `development` | `DOTNOTE_DEV=1`: never redeploy from local dev |
| `no_installer` | No `INSTALLER_ORIGIN` |
| `unconfigured` | No `WORKER_NAME`, OAuth client id, or grant key: deployed with wrangler, so update it with wrangler |
| `not_connected` | No stored Cloudflare grant |
| `missing_scopes` | The grant lacks `workers-scripts.read` or `workers-scripts.write`. The banner offers **Reconnect** |

The page will not start an update while it has unsynced changes or an import is running.

## Rollback

**Settings › Cloudflare › Go back to x.y.z** runs the same job toward the version this Dotnote updated itself from, using its archived manifest. It runs no migrations; tables added by the newer version stay. There is no automatic rollback: a failure alone does not tell code problems from data problems.

## Compatibility rules

- `update_jobs`, `schema_migrations` and `app_meta` columns may be added, never renamed: an older Worker reads them after a rollback.
- The `/api/update/*` responses must stay readable by the previous version's page, which drives the job until it reloads.
- A release that needs a new binding must create it in the updater (and the installer) or treat it as optional. The updater only carries over the bindings the script already has.
- Dotnotes installed before self-update existed (0.1.0) have no updater. They need one redeploy to a release that has it.
