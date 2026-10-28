import MarkdownPreview from "@uiw/react-markdown-preview";
import { observer } from "mobx-react-lite";

import { themeStore } from "@/stores/theme-store";

import "@uiw/react-markdown-preview/markdown.css";

export const ReleaseNotesPreview = observer(function ReleaseNotesPreview({ source }: { source: string }) {
  return (
    <div className="max-h-72 min-h-0 overflow-auto rounded-sm border border-divider bg-well px-3 py-2">
      <MarkdownPreview
        source={source}
        wrapperElement={{ "data-color-mode": themeStore.resolved }}
        style={{ backgroundColor: "transparent" }}
        className="!bg-transparent !text-[13px] [&_h1]:!mt-1 [&_h1]:!border-0 [&_h1]:!pb-0 [&_h1]:!text-base [&_h2]:!border-0 [&_h2]:!pb-0 [&_h2]:!text-sm [&_ul]:!list-disc"
      />
    </div>
  );
});
