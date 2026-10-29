import { AlertCircle, Check, ChevronDown, Settings } from "lucide-react";
import { observer } from "mobx-react-lite";
import { toast } from "sonner";
import { compactModelLabel, formatLlmModelPrice, textModelsForProvider, type LlmProviderId } from "@shared/llm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { llmStore } from "@/stores/llm-store";

/** Marks portaled menus so the AI bar does not treat clicks in them as "outside". */
export const AI_BAR_PORTAL_ATTR = "data-ai-bar-portal";

/** Model chip for the AI bar, after tablepad's BlockLlmSelector. */
export const AiModelSelect = observer(function AiModelSelect({
  onOpenSettings,
  onAfterClose,
  disabled,
}: {
  onOpenSettings: () => void;
  /** Hand focus back to the AI input once the menu closes. */
  onAfterClose?: () => void;
  disabled?: boolean;
}) {
  const settings = llmStore.settings;
  if (!settings) return null;

  if (llmStore.configuredProviders.length === 0) {
    return (
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-danger hover:bg-danger/10"
        title="Add an API key"
      >
        <AlertCircle className="size-3.5" />
        Add key
      </button>
    );
  }

  const select = async (provider: LlmProviderId, modelId: string) => {
    if (settings.activeProvider === provider && settings.model === modelId) return;
    try {
      await llmStore.update({ activeProvider: provider, model: modelId });
    } catch {
      toast.error("Could not switch model");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || llmStore.saving}>
        <button
          type="button"
          className={cn(
            "flex h-7 max-w-[150px] shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium hover:bg-raised disabled:opacity-50",
            llmStore.ready ? "text-dim hover:text-ink" : "text-danger",
          )}
          title="Change model"
        >
          <span className="truncate">{compactModelLabel(settings.activeProvider, settings.model)}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        {...{ [AI_BAR_PORTAL_ATTR]: "" }}
        align="end"
        className="max-h-[min(420px,70vh)] w-64 overflow-y-auto"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onAfterClose?.();
        }}
      >
        {llmStore.configuredProviders.map((provider, index) => (
          <div key={provider.id}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="flex items-center justify-between gap-2 pr-2 text-[10px] text-dim">
              <span>{provider.name}</span>
              <span className="font-normal tabular-nums">$/1M in/out</span>
            </DropdownMenuLabel>
            {textModelsForProvider(provider.id).map((m) => {
              const selected = settings.activeProvider === provider.id && settings.model === m.id;
              return (
                <DropdownMenuItem
                  key={m.id}
                  className="flex items-center gap-2 text-xs"
                  onSelect={() => void select(provider.id, m.id)}
                >
                  <span className="min-w-0 flex-1 truncate">{compactModelLabel(provider.id, m.id)}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-dim">{formatLlmModelPrice(m)}</span>
                  <span className="flex w-3.5 shrink-0 justify-center">
                    {selected ? <Check className="size-3.5 text-accent-color" /> : null}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenSettings} className="text-xs">
          <Settings className="size-3.5" /> AI settings…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
