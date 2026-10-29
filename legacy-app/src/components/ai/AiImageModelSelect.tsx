import { AlertCircle, Check, ChevronDown, Settings } from "lucide-react";
import { observer } from "mobx-react-lite";
import { toast } from "sonner";
import { IMAGE_MODEL_CATALOG, findImageModel, getImageModelProvider } from "@shared/llm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AI_BAR_PORTAL_ATTR } from "@/components/ai/AiModelSelect";
import { cn } from "@/lib/utils";
import { llmStore } from "@/stores/llm-store";

/** Image-model chip for the AI bar. Writes the same setting as Settings → AI Image. */
export const AiImageModelSelect = observer(function AiImageModelSelect({
  onOpenSettings,
  onAfterClose,
  disabled,
  requireImageInput,
}: {
  onOpenSettings: () => void;
  onAfterClose?: () => void;
  disabled?: boolean;
  /** Disable models that cannot take the current image as input. */
  requireImageInput?: boolean;
}) {
  const settings = llmStore.settings;
  if (!settings) return null;

  const current = findImageModel(settings.imageModel);
  const provider = getImageModelProvider(settings.imageModel);
  const ready = Boolean(settings.configuredProviders[provider]);

  if (!ready && llmStore.configuredProviders.length === 0 && provider === "gemini") {
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

  const select = async (modelId: string) => {
    if (settings.imageModel === modelId) return;
    try {
      await llmStore.update({ imageModel: modelId });
    } catch {
      toast.error("Could not switch image model");
    }
  };

  const groups = IMAGE_MODEL_CATALOG.reduce<{ provider: string; models: typeof IMAGE_MODEL_CATALOG }[]>((acc, model) => {
    const last = acc[acc.length - 1];
    if (!last || last.provider !== model.provider) acc.push({ provider: model.provider, models: [model] });
    else last.models.push(model);
    return acc;
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || llmStore.saving}>
        <button
          type="button"
          className={cn(
            "flex h-7 max-w-[180px] shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium hover:bg-raised disabled:opacity-50",
            ready ? "text-dim hover:text-ink" : "text-danger",
          )}
          title={ready ? "Change image model" : "Add an API key for this image model"}
        >
          <span className="truncate">{current?.label ?? settings.imageModel}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        {...{ [AI_BAR_PORTAL_ATTR]: "" }}
        align="end"
        className="max-h-[min(420px,70vh)] w-72 overflow-y-auto"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onAfterClose?.();
        }}
      >
        {groups.map((group, index) => (
          <div key={group.provider}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-[10px] text-dim">
              {group.provider === "openai" ? "OpenAI" : "Google Gemini"}
            </DropdownMenuLabel>
            {group.models.map((model) => {
              const selected = settings.imageModel === model.id;
              const blocked = Boolean(requireImageInput && !model.supportsImageInput);
              return (
                <DropdownMenuItem
                  key={model.id}
                  disabled={blocked}
                  className="flex items-center gap-2 text-xs"
                  title={blocked ? "This model can't edit an existing image" : model.notes}
                  onSelect={() => void select(model.id)}
                >
                  <span className="min-w-0 flex-1 truncate">{model.label}</span>
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
          <Settings className="size-3.5" /> AI Image settings…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
