# Public tree scope

This folder is the **public** Dotnote source tree (a separate git repository from the private ops monorepo).

| Included | Excluded (stay in private `dotnote-ops`) |
|----------|------------------------------------------|
| `app/`, `legacy-app/`, `installer/` | `hq/`, `website/` (dotnote.cloud) |
| `scripts/pack-release.mjs`, `release-notes/` | `design/`, `PRODUCT.md` |
| `docs/`, `README.md` | `scripts/create-installer-oauth-client.mjs` |
| `LICENSE.md`, `TRADEMARKS.md`, `CONTRIBUTING.md` | Production `wrangler.jsonc`, `.dev.vars` |

## License

Source-available under the Sustainable Use License 1.0 — see `LICENSE.md` and `docs/license-faq.md`. Package manifests use `"license": "SEE LICENSE IN LICENSE.md"`.

## Local Wrangler config

Copy each `wrangler.example.jsonc` to `wrangler.jsonc` in the same package and fill in your Cloudflare resource IDs. Real `wrangler.jsonc` files are gitignored.
