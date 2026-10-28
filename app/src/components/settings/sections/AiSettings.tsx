import { useEffect, useMemo, useState } from "react";
import { ExternalLink, KeyRound, MoreHorizontal, Plus, RefreshCw, Trash2 } from "lucide-react";
import { observer } from "mobx-react-lite";
import { toast } from "sonner";
import {
  LLM_PROVIDER_META,
  findLlmModel,
  formatLlmModelPrice,
  getLlmProviderMeta,
  textModelsForProvider,
  type LlmProviderId,
} from "@shared/llm";
import { SettingsField, SettingsSectionShell } from "@/components/settings/SettingsSectionShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import { llmStore } from "@/stores/llm-store";
import { uiPreferenceStore } from "@/stores/ui-preference-store";

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const allProviderOptions = LLM_PROVIDER_META.map((p) => ({ value: p.id, label: p.name }));

export const AiSettings = observer(function AiSettings() {
  const settings = llmStore.settings;
  const [activeProvider, setActiveProvider] = useState<LlmProviderId>("anthropic");
  const [model, setModel] = useState("");
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [newKeyProvider, setNewKeyProvider] = useState<LlmProviderId>("anthropic");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [busyProvider, setBusyProvider] = useState<LlmProviderId | null>(null);

  useEffect(() => {
    void llmStore.ensureLoaded();
  }, []);

  const configured = llmStore.configuredProviders;
  const configuredProviderOptions = configured.map((p) => ({ value: p.id, label: p.name }));

  useEffect(() => {
    if (!settings) return;
    const savedProvider = settings.activeProvider;
    if (settings.configuredProviders[savedProvider]) {
      setActiveProvider(savedProvider);
      const selectable = textModelsForProvider(savedProvider);
      setModel(selectable.some((m) => m.id === settings.model) ? settings.model : (selectable[0]?.id ?? settings.model));
      return;
    }
    const fallback = LLM_PROVIDER_META.find((p) => settings.configuredProviders[p.id]);
    if (fallback) {
      setActiveProvider(fallback.id);
      setModel(textModelsForProvider(fallback.id)[0]?.id ?? settings.model);
    }
  }, [settings]);

  const modelOptions = useMemo(
    () =>
      textModelsForProvider(activeProvider).map((m) => ({
        value: m.id,
        label: m.label,
        detail: formatLlmModelPrice(m),
      })),
    [activeProvider],
  );
  const selectedModelMeta = findLlmModel(activeProvider, model);
  const modelDirty = Boolean(settings && (settings.activeProvider !== activeProvider || settings.model !== model));

  const handleProviderChange = (value: string) => {
    const provider = value as LlmProviderId;
    setActiveProvider(provider);
    setModel(textModelsForProvider(provider)[0]?.id ?? "");
  };

  const saveModel = async () => {
    try {
      await llmStore.update({ activeProvider, model });
      toast.success("Active model updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const saveKey = async () => {
    const trimmed = newKeyValue.trim();
    if (!trimmed) return;
    setBusyProvider(newKeyProvider);
    try {
      await llmStore.update({ apiKeys: { [newKeyProvider]: trimmed } });
      setNewKeyValue("");
      setIsAddingKey(false);
      toast.success(`${getLlmProviderMeta(newKeyProvider).name} API key saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save API key");
    } finally {
      setBusyProvider(null);
    }
  };

  const deleteKey = async (providerId: LlmProviderId) => {
    setBusyProvider(providerId);
    try {
      await llmStore.update({ apiKeys: { [providerId]: "" } });
      toast.success(`${getLlmProviderMeta(providerId).name} API key removed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove API key");
    } finally {
      setBusyProvider(null);
    }
  };

  const newProviderMeta = getLlmProviderMeta(newKeyProvider);
  const activeModelDisabled = !settings || configured.length === 0;

  return (
    <SettingsSectionShell
      title="AI"
      description="Bring your own key. Press ⌘J in a note, or select text and click Ask AI. Keys stay on this Worker; the browser only sees a masked copy."
      className="pb-10"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Provider API keys</h2>
          <p className="text-xs text-dim">Requests go from this Worker straight to the provider and bill your account.</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void llmStore.refresh()} disabled={llmStore.loading}>
          <RefreshCw className={cn("size-3.5", llmStore.loading && "animate-spin")} />
          <span className="sr-only">Refresh</span>
        </Button>
      </div>

      {llmStore.error ? <p className="text-xs text-danger">{llmStore.error}</p> : null}

      {configured.length > 0 ? (
        <div className="flex flex-col gap-2">
          {configured.map((provider) => (
            <div key={provider.id} className="flex items-center justify-between border border-divider bg-panel p-3">
              <div className="flex items-center gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center border border-divider bg-raised">
                  <KeyRound className="size-4 text-dim" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{provider.name}</span>
                    <span className="bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                      Configured
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-dim">
                    <span className="font-mono">{settings?.maskedApiKeys[provider.id] ?? "••••••••"}</span>
                    <span>·</span>
                    <a
                      href={provider.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center hover:underline"
                    >
                      Keys console
                      <ExternalLink className="ml-1 size-2.5" />
                    </a>
                  </div>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" disabled={busyProvider === provider.id}>
                    <MoreHorizontal className="size-4" />
                    <span className="sr-only">Actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onSelect={() => void deleteKey(provider.id)}>
                    <Trash2 />
                    Delete key
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      ) : !isAddingKey && settings ? (
        <div className="border border-dashed border-divider p-6 text-center">
          <KeyRound className="mx-auto size-7 text-dim/60" />
          <p className="mt-2 text-sm font-medium text-ink">No API keys yet</p>
          <p className="text-xs text-dim">Add a key to turn on AI editing in notes.</p>
        </div>
      ) : null}

      {isAddingKey ? (
        <Card>
          <CardHeader>
            <CardTitle>Add API key</CardTitle>
            <CardDescription>Choose a provider and paste a key from its console.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <SettingsField label="Provider">
              <FieldSelect
                value={newKeyProvider}
                onValueChange={(v) => setNewKeyProvider(v as LlmProviderId)}
                options={allProviderOptions}
                className="w-full"
              />
            </SettingsField>
            <SettingsField
              label="API key"
              hint={
                <a href={newProviderMeta.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center hover:underline">
                  Get an API key from {newProviderMeta.name}
                  <ExternalLink className="ml-1 size-3" />
                </a>
              }
            >
              <Input
                type="password"
                autoComplete="off"
                placeholder={`Paste ${newProviderMeta.name} API key`}
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
                disabled={busyProvider !== null}
              >
                Cancel
              </Button>
              <Button variant="default" onClick={() => void saveKey()} disabled={busyProvider !== null || !newKeyValue.trim()}>
                {busyProvider ? "Saving…" : "Save key"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div>
          <Button variant="outline" onClick={() => setIsAddingKey(true)}>
            <Plus />
            Add new key
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Translation</CardTitle>
          <CardDescription>
            Default target for “Translate to …” when you select text. Detected from your browser until you change it here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsField label="Target language">
            <FieldSelect
              value={uiPreferenceStore.aiTranslateTarget}
              onValueChange={(value) => uiPreferenceStore.setAiTranslateTarget(value)}
              options={SUPPORTED_LANGUAGES.map((lang) => ({
                value: lang.code,
                label: `${lang.name} (${lang.nativeName})`,
              }))}
              className="w-full"
            />
          </SettingsField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active model</CardTitle>
          <CardDescription>Used by ⌘J and Ask AI. You can also switch it from the AI bar in a note.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {activeModelDisabled ? (
            <p className="text-xs text-dim">Add at least one provider API key above to choose an active model.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <SettingsField label="Provider">
                <FieldSelect
                  value={activeProvider}
                  onValueChange={handleProviderChange}
                  options={configuredProviderOptions}
                  className="w-full"
                />
              </SettingsField>
              <SettingsField label="Model">
                <FieldSelect value={model} onValueChange={setModel} options={modelOptions} className="w-full" />
              </SettingsField>
            </div>
          )}
          {selectedModelMeta?.thinking === "always-on" ? (
            <p className="text-xs text-danger">This model always reasons. Choose another one — reasoning stays off for notes.</p>
          ) : null}
          {selectedModelMeta && !activeModelDisabled && selectedModelMeta.thinking !== "always-on" ? (
            <p className="text-xs text-dim">
              {formatUsd(selectedModelMeta.inputPer1MUsd)} / {formatUsd(selectedModelMeta.outputPer1MUsd)} per 1M tokens (in / out)
              {selectedModelMeta.contextTokens ? ` · ${selectedModelMeta.contextTokens.toLocaleString()} context` : ""}
              {selectedModelMeta.notes ? ` · ${selectedModelMeta.notes}` : ""}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              variant="default"
              onClick={() => void saveModel()}
              disabled={llmStore.saving || !modelDirty || activeModelDisabled || selectedModelMeta?.thinking === "always-on"}
            >
              {llmStore.saving ? "Saving…" : "Save model"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </SettingsSectionShell>
  );
});
