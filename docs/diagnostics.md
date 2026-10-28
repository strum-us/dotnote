# Diagnostics

Dotnote can register a deployment with Dotnote Cloud so the operator can recognize the instance and send security notices. Registration is **off** until the owner opts in, and a deployment can refuse it entirely.

Nothing about your notes is included. The password is not included.

## What is sent

Only after you opt in, and only when this deployment is allowed to send:

| Field | Meaning |
|---|---|
| `email` | The owner account email |
| `cfAccountId` | The Cloudflare account id bound at install |
| `workerName` | The Worker name |
| `workerUrl` | This Dotnote's address |
| `instanceId` | A random id created for this registration |
| `appVersion` | The Dotnote version |
| `occurredAt` | When this registration was sent |

The exact JSON is on **Settings → Account → View exact payload**.

Not sent: password or password hash, note titles, note bodies, folder names, workspace names, API keys, or Cloudflare tokens.

## When it sends

A registration leaves the Worker only if all of these are true:

1. `DOTNOTE_DIAGNOSTICS_ENABLED` is `true` (or `1`).
2. `DOTNOTE_DIAGNOSTICS_URL` is set.
3. The `DOTNOTE_DIAGNOSTICS_TOKEN` secret is set.
4. The owner has granted the current consent version.

Account creation does not send anything unless the owner checks the registration box. Logging in does not send anything. An unchanged registration is not sent again.

The installer writes the URL, sets `DOTNOTE_DIAGNOSTICS_ENABLED` to `true`, and stores the token. That makes the deployment *able* to register. It is not consent. The owner still has to opt in.

A source deploy that leaves the switch at `false`, or that never sets the token, never sends a registration.

## How to turn it off

Any one of these is enough:

- **Settings → Account.** Uncheck the registration. You can also delete the registration already stored by Dotnote Cloud.
- Set `DOTNOTE_DIAGNOSTICS_ENABLED` to `false` and redeploy. Consent does not override this.
- Remove the `DOTNOTE_DIAGNOSTICS_TOKEN` secret.

Stopping sending does not by itself delete a registration already accepted. Use **Delete registration** in Settings, or email privacy@dotnote.cloud.
