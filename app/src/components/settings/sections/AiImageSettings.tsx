import { useEffect, useMemo, useState } from "react";
import { ExternalLink, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { observer } from "mobx-react-lite";
import { toast } from "sonner";
import {
  GEMINI_IMAGE_MODEL_CATALOG,
  IMAGE_ASPECT_RATIOS,
  findImageModel,
  getLlmProviderMeta,
  type ImageAspectRatio,
} from "@shared/llm";
import { SettingsField, SettingsSectionShell } from "@/components/settings/SettingsSectionShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { llmStore } from "@/stores/llm-store";

const geminiMeta = getLlmProviderMeta("gemini");

const aspectOptions = IMAGE_ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }));

export const AiImageSettings = observer(function AiImageSettings() {
  const settings = llmStore.settings;
  const [imageModel, setImageModel] = useState("");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("16:9");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [busyKey, setBusyKey] = useState(false);

  useEffect(() => {
    void llmStore.ensureLoaded();
  }, []);

  useEffect(() => {
    if (!settings) return;
    setImageModel(settings.imageModel);
    setAspectRatio(settings.imageAspectRatio);
  }, [settings]);

  const modelOptions = useMemo(
    () => GEMINI_IMAGE_MODEL_CATALOG.map((m) => ({ value: m.id, label: m.label })),
    [],
  );
  const selectedMeta = findImageModel(imageModel);
  const imageDirty = Boolean(
    settings && (settings.imageModel !== imageModel || settings.imageAspectRatio !== aspectRatio),
  );
  const geminiConfigured = Boolean(settings?.configuredProviders.gemini);

  const saveImagePrefs = async () => {
    try {
      await llmStore.update({ imageModel, imageAspectRatio: aspectRatio });
      toast.success("AI image settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const saveKey = async () => {
    const trimmed = newKeyValue.trim();
    if (!trimmed) return;
    setBusyKey(true);
    try {
      await llmStore.update({ apiKeys: { gemini: trimmed } });
      setNewKeyValue("");
      setIsAddingKey(false);
      toast.success("Gemini API key saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save API key");
    } finally {
      setBusyKey(false);
    }
  };

  const deleteKey = async () => {
    setBusyKey(true);
    try {
      await llmStore.update({ apiKeys: { gemini: "" } });
      toast.success("Gemini API key removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove API key");
    } finally {
      setBusyKey(false);
    }
  };

  return (
    <SettingsSectionShell
      title="AI Image"
      description="Generate images in notes with Google Gemini (free tier on AI Studio). Keys stay on this Worker; images save to your R2 bucket like pasted uploads."
      className="pb-10"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Gemini API key</h2>
          <p className="text-xs text-dim">Image generation uses your Gemini key only — separate from the text model in Settings → AI.</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void llmStore.refresh()} disabled={llmStore.loading}>
          <RefreshCw className={cn("size-3.5", llmStore.loading && "animate-spin")} />
          <span className="sr-only">Refresh</span>
        </Button>
      </div>

      {llmStore.error ? <p className="text-xs text-danger">{llmStore.error}</p> : null}

      {geminiConfigured && settings && !isAddingKey ? (
        <div className="flex items-center justify-between border border-divider bg-panel p-3">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center border border-divider bg-raised">
              <KeyRound className="size-4 text-dim" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink">{geminiMeta.name}</span>
                <span className="bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                  Configured
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-dim">
                <span className="font-mono">{settings.maskedApiKeys.gemini ?? "••••••••"}</span>
                <span>·</span>
                <a href={geminiMeta.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center hover:underline">
                  AI Studio keys
                  <ExternalLink className="ml-1 size-2.5" />
                </a>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setIsAddingKey(true)} disabled={busyKey}>
            Replace
          </Button>
        </div>
      ) : null}

      {!geminiConfigured && settings && !isAddingKey ? (
        <div className="border border-dashed border-divider p-6 text-center">
          <KeyRound className="mx-auto size-7 text-dim/60" />
          <p className="mt-2 text-sm font-medium text-ink">No Gemini key yet</p>
          <p className="text-xs text-dim">Add a key from Google AI Studio to enable image generation.</p>
          <Button variant="outline" className="mt-4" onClick={() => setIsAddingKey(true)}>
            <Plus />
            Add Gemini key
          </Button>
        </div>
      ) : null}

      {isAddingKey ? (
        <Card>
          <CardHeader>
            <CardTitle>{geminiConfigured ? "Replace Gemini key" : "Add Gemini API key"}</CardTitle>
            <CardDescription>Paste a key from Google AI Studio. The free tier includes image generation quotas.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <SettingsField
              label="API key"
              hint={
                <a href={geminiMeta.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center hover:underline">
                  Get a key from {geminiMeta.name}
                  <ExternalLink className="ml-1 size-3" />
                </a>
              }
            >
              <Input
                type="password"
                autoComplete="off"
                placeholder="Paste Gemini API key"
                value={newKeyValue}
                onChange={(e) => setNewKeyValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveKey();
                }}
                autoFocus
              />
            </SettingsField>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsAddingKey(false);
                  setNewKeyValue("");
                }}
                disabled={busyKey}
              >
                Cancel
              </Button>
              <Button variant="default" onClick={() => void saveKey()} disabled={busyKey || !newKeyValue.trim()}>
                {busyKey ? "Saving…" : "Save key"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {geminiConfigured && !isAddingKey ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => void deleteKey()} disabled={busyKey}>
            <Trash2 className="size-4" />
            Remove key
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Image model</CardTitle>
          <CardDescription>Used when you generate images from the AI bar (⌘J → Generate image).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <SettingsField label="Model">
              <FieldSelect value={imageModel} onValueChange={setImageModel} options={modelOptions} className="w-full" />
            </SettingsField>
            <SettingsField label="Aspect ratio">
              <FieldSelect
                value={aspectRatio}
                onValueChange={(v) => setAspectRatio(v as ImageAspectRatio)}
                options={aspectOptions}
                className="w-full"
              />
            </SettingsField>
          </div>
          {selectedMeta?.notes ? <p className="text-xs text-dim">{selectedMeta.notes}</p> : null}
          {!geminiConfigured ? (
            <p className="text-xs text-danger">Add a Gemini API key above to generate images.</p>
          ) : null}
          <div className="flex justify-end">
            <Button variant="default" onClick={() => void saveImagePrefs()} disabled={llmStore.saving || !imageDirty}>
              {llmStore.saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </SettingsSectionShell>
  );
});
