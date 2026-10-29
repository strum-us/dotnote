import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type MarkdownRawEditorHandle = {
  flushSnapshot(): void;
};

type MarkdownRawEditorProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

/** Readable column width for rich text and public render views. */
export const MARKDOWN_COLUMN_CLASS = "mx-auto w-full max-w-3xl px-6 py-8";

export const MarkdownRawEditor = forwardRef<MarkdownRawEditorHandle, MarkdownRawEditorProps>(
  function MarkdownRawEditor({ value, onChange, className }, ref) {
    const valueRef = useRef(value);
    const onChangeRef = useRef(onChange);
    valueRef.current = value;
    onChangeRef.current = onChange;

    useImperativeHandle(
      ref,
      () => ({
        flushSnapshot() {
          onChangeRef.current(valueRef.current);
        },
      }),
      [],
    );

    useEffect(() => {
      return () => {
        onChangeRef.current(valueRef.current);
      };
    }, []);

    return (
      <div className={cn("min-h-0 min-w-0 flex-1 overflow-auto bg-well", className)}>
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className={cn(
            "box-border block min-h-full w-full max-w-none resize-none rounded-none border-0 bg-transparent px-6 py-8 font-mono text-[13px] leading-relaxed shadow-none focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0",
          )}
        />
      </div>
    );
  },
);
