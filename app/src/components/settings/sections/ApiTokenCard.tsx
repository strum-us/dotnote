import { useState, type FormEvent } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { observer } from "mobx-react-lite";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsField } from "@/components/settings/SettingsSectionShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cloudflareStore } from "@/stores/cloudflare-store";
import { updateStore } from "@/stores/update-store";
import type { UpdateBlockedReason } from "@shared/types";

/** Blocked states an API token fixes. */
const TOKEN_FIXES = new Set<UpdateBlockedReason>(["unconfigured", "not_connected", "missing_scopes"]);
/** Rejections that need the Worker name or account the server could not work out. */
const NEEDS_DETAILS = new Set(["need_worker", "need_account", "worker_not_found", "not_this_worker"]);

const TOKENS_URL = "https://dash.cloudflare.com/profile/api-tokens";

/**
 * Settings › Cloudflare: a Cloudflare API token for a Dotnote with no
 * installer grant (worker/update/api-token.ts). Given once, it lets the
 * Worker update itself without asking again.
 */
export const ApiTokenCard = observer(function ApiTokenCard() {
  const [token, setToken] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const status = cloudflareStore.status;
  const apiToken = status?.apiToken;
  const blocked = updateStore.check?.blockedReason ?? null;
  if (!status || !apiToken) return null;
  if (!apiToken.stored && !(blocked && TOKEN_FIXES.has(blocked))) return null;

  const details = showDetails || NEEDS_DETAILS.has(cloudflareStore.tokenErrorCode ?? "");
  const busy = cloudflareStore.tokenBusy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await cloudflareStore.saveToken({
      token: token.trim(),
      workerName: workerName.trim() || undefined,
      accountId: accountId.trim() || undefined,
    });
    if (saved) setToken("");
  }

  const feedback = (
    <>
      {cloudflareStore.tokenMessage ? <p className="text-xs text-dim">{cloudflareStore.tokenMessage}</p> : null}
      {cloudflareStore.tokenError ? <p className="text-xs text-danger">{cloudflareStore.tokenError}</p> : null}
    </>
  );

  if (apiToken.stored) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Update access</CardTitle>
          <CardDescription>
            This Dotnote updates itself with a Cloudflare API token stored as the CF_API_TOKEN secret on its Worker.
            The token is never shown again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <p className="text-xs text-dim">
            Worker {apiToken.workerName ?? "unknown"} · account {apiToken.accountId ?? "unknown"}
          </p>
          {feedback}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmRemove(true)}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Remove token
          </Button>
        </CardContent>
        <ConfirmDialog
          open={confirmRemove}
          title="Remove the API token"
          description="This Dotnote stops updating itself until you give it a token again or reconnect Cloudflare. Revoke the token in Cloudflare as well if you no longer need it."
          confirmLabel="Remove"
          onOpenChange={setConfirmRemove}
          onConfirm={() => void cloudflareStore.removeToken()}
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Let this Dotnote update itself</CardTitle>
        <CardDescription>
          {blocked === "unconfigured"
            ? "This Dotnote was not deployed by the installer, so it holds no Cloudflare permission to replace its Worker. Give it an API token once; it updates itself from then on."
            : "The Cloudflare permission from the installer is missing or too narrow. Reconnect above, or give this Dotnote an API token instead."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
          <p className="text-xs text-dim">
            Create a token in Cloudflare under My Profile › API Tokens with one permission: Account › Workers Scripts
            › Edit, for the account this Dotnote runs in. Dotnote checks that the token opens this very Worker, stores it
            there as a secret, and keeps no other copy.
          </p>
          <Button size="sm" variant="outline" className="w-fit" asChild>
            <a href={TOKENS_URL} target="_blank" rel="noreferrer">
              Open API Tokens <ExternalLink className="size-3.5" />
            </a>
          </Button>
          <SettingsField label="API token">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste the token"
            />
          </SettingsField>
          {details ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <SettingsField label="Worker name" hint="As shown in Workers & Pages.">
                <Input
                  value={workerName}
                  onChange={(event) => setWorkerName(event.target.value)}
                  placeholder={status.worker.name}
                  spellCheck={false}
                />
              </SettingsField>
              <SettingsField label="Account ID" hint="Optional when the token opens one account.">
                <Input
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  placeholder={status.accountId ?? ""}
                  spellCheck={false}
                />
              </SettingsField>
            </div>
          ) : (
            <button
              type="button"
              className="w-fit text-xs text-dim underline-offset-2 hover:text-ink hover:underline"
              onClick={() => setShowDetails(true)}
            >
              Set the Worker name or account
            </button>
          )}
          {feedback}
          <Button type="submit" size="sm" className="w-fit" disabled={busy || token.trim().length < 20}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Save token
          </Button>
        </form>
      </CardContent>
    </Card>
  );
});
