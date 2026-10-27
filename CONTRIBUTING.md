# Contributing to Dotnote

Thanks for your interest. Dotnote is source-available under the [Sustainable Use License](./LICENSE.md); please read [docs/license-faq.md](./docs/license-faq.md) before contributing.

## Contributor License Agreement

We can only accept contributions after you sign our Contributor License Agreement (CLA), which lets Strum Technology Corp keep offering Dotnote under the Sustainable Use License and under separate commercial licenses. If you open a pull request, we will ask you to sign the CLA first. Do not submit code you do not have the right to contribute.

## Development setup

Prerequisites: Node.js 22+, pnpm 9.12+, and a Cloudflare account for deployment testing.

```bash
pnpm install
cp app/wrangler.example.jsonc app/wrangler.jsonc   # fill in your own resource IDs
pnpm dev
```

See the "Local development" section of [README.md](./README.md) for ports and the self-hosting guide for deployment.

## Before opening a pull request

- Keep components free of direct `fetch` calls and store assignments; call MobX store actions instead (see `docs/local-first.md`).
- Run the checks that apply to your change:
  - App: `pnpm --filter dotnote-app run build`
  - Installer: `pnpm --filter dotnote-installer run typecheck`
- Describe what changed and how you tested it.

## Reporting bugs

Open an issue with steps to reproduce, your deployment type (installer or self-hosted from source), and browser/Worker details. Do not include note content, API keys, or Cloudflare tokens in reports.
