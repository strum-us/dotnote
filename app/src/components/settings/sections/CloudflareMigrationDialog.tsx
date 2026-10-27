import { useCallback, useState } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { R2MigrationCursor } from "@shared/types";
import { cloudflareApi } from "@/lib/api";
import { formatBytes } from "@/lib/format-bytes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SettingsField } from "@/components/settings/SettingsSectionShell";

type Step = "intro" | "connect" | "copy" | "done";

export function CloudflareMigrationDialog({
  open,
  onOpenChange,
  links,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: { createBucket: string; r2ApiTokens: string } | null;
}) {
  const [step, setStep] = useState<Step>("intro");
  const [accountId, setAccountId] = useState("");
  const [bucketName, setBucketName] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [copying, setCopying] = useState(false);
  const [copiedObjects, setCopiedObjects] = useState(0);
  const [copiedBytes, setCopiedBytes] = useState(0);
  const [copyErrors, setCopyErrors] = useState(0);

  const reset = useCallback(() => {
    setStep("intro");
    setAccountId("");
    setBucketName("");
    setAccessKeyId("");
    setSecretAccessKey("");
    setCopying(false);
    setCopiedObjects(0);
    setCopiedBytes(0);
    setCopyErrors(0);
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next && copying) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const runCopy = async () => {
    if (!accountId.trim() || !bucketName.trim() || !accessKeyId.trim() || !secretAccessKey) {
      toast.error("Fill in all destination fields.");
      return;
    }
    setStep("copy");
    setCopying(true);
    setCopiedObjects(0);
    setCopiedBytes(0);
    setCopyErrors(0);

    let cursor: R2MigrationCursor | undefined;
    try {
      for (;;) {
        const batch = await cloudflareApi.copyBatch({
          accountId: accountId.trim(),
          bucketName: bucketName.trim(),
          accessKeyId: accessKeyId.trim(),
          secretAccessKey,
          cursor,
        });
        setCopiedObjects((n) => n + batch.copied);
        setCopiedBytes((n) => n + batch.bytesCopied);
        if (batch.errors.length > 0) setCopyErrors((n) => n + batch.errors.length);
        if (batch.done || !batch.cursor) {
          setStep("done");
          break;
        }
        cursor = batch.cursor;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Copy failed");
      setStep("connect");
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy R2 to your account</DialogTitle>
          <DialogDescription>
            Cloudflare cannot transfer buckets between accounts. Dotnote copies your workspace objects into a bucket
            you own using R2 S3 credentials.
          </DialogDescription>
        </DialogHeader>

        {step === "intro" ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-dim">
              Create an empty bucket and an R2 API token with read/write on that bucket. This app still reads the
              original bucket until you deploy your own Dotnote worker bound to the copy.
            </p>
            <div className="flex flex-wrap gap-2">
              {links ? (
                <>
                  <Button size="sm" variant="outline" asChild>
                    <a href={links.createBucket} target="_blank" rel="noreferrer">
                      Create bucket <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={links.r2ApiTokens} target="_blank" rel="noreferrer">
                      R2 API tokens <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                </>
              ) : null}
            </div>
            <Button className="w-full" onClick={() => setStep("connect")}>
              Continue
            </Button>
          </div>
        ) : null}

        {step === "connect" ? (
          <div className="flex flex-col gap-4">
            <SettingsField label="Cloudflare account ID" hint="Found in the R2 overview URL or Workers dashboard.">
              <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} autoComplete="off" />
            </SettingsField>
            <SettingsField label="Destination bucket name">
              <Input value={bucketName} onChange={(e) => setBucketName(e.target.value)} autoComplete="off" />
            </SettingsField>
            <SettingsField label="Access key ID">
              <Input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} autoComplete="off" />
            </SettingsField>
            <SettingsField label="Secret access key" hint="Sent only over HTTPS for copy batches; never stored on the server.">
              <Input
                type="password"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                autoComplete="off"
              />
            </SettingsField>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("intro")}>
                Back
              </Button>
              <Button className="flex-1" onClick={() => void runCopy()} disabled={copying}>
                Start copy
              </Button>
            </div>
          </div>
        ) : null}

        {step === "copy" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">Copying objects to your bucket…</p>
            <p className="font-mono text-sm text-dim">
              {copiedObjects} objects · {formatBytes(copiedBytes)}
              {copyErrors > 0 ? ` · ${copyErrors} errors` : ""}
            </p>
            <p className="text-xs text-dim">Keep this dialog open until the copy finishes.</p>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink">
              Copied {copiedObjects} objects ({formatBytes(copiedBytes)}) into{" "}
              <span className="font-medium">{bucketName}</span>.
              {copyErrors > 0 ? ` ${copyErrors} objects failed — check bucket permissions and retry.` : ""}
            </p>
            <Button
              className="w-full"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Close
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
