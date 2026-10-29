import { createContext, useContext } from "react";
import { FormattingToolbar, getFormattingToolbarItems, useComponentsContext } from "@blocknote/react";
import { Sparkles } from "lucide-react";

/** Opens the AI bar on the current selection; provided by the editor host. */
export const AiOpenContext = createContext<(() => void) | null>(null);

function AiToolbarButton() {
  const Components = useComponentsContext()!;
  const open = useContext(AiOpenContext);
  if (!open) return null;
  return (
    <Components.FormattingToolbar.Button
      className="bn-button gap-1 px-2 font-medium text-accent-color"
      label="Ask AI"
      mainTooltip="Ask AI"
      secondaryTooltip="⌘J"
      icon={<Sparkles className="size-3.5" />}
      onClick={open}
    >
      Ask AI
    </Components.FormattingToolbar.Button>
  );
}

/** BlockNote's default formatting toolbar with Ask AI in front. */
export function EditorFormattingToolbar() {
  return (
    <FormattingToolbar>
      <AiToolbarButton key="askAi" />
      {getFormattingToolbarItems()}
    </FormattingToolbar>
  );
}
