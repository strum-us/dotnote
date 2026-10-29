import MarkdownPreview from "@uiw/react-markdown-preview";
import { observer } from "mobx-react-lite";
import { useMemo, type ComponentProps } from "react";

import { publicShareAssetApiUrl } from "@/lib/public-share-assets";
import { resolveMarkdownAssetHref } from "@/lib/page-assets-client";
import { MARKDOWN_COLUMN_CLASS } from "@/components/MarkdownRawEditor";
import { cn } from "@/lib/utils";
import { themeStore } from "@/stores/theme-store";

import "@uiw/react-markdown-preview/markdown.css";
import "@/markdown-view.css";

type MarkdownViewProps = {
  source: string;
  className?: string;
} & (
  | { mode: "workspace"; workspaceId: string; notePath: string }
  | { mode: "share"; shareToken: string; notePath: string }
);

type MarkdownImgProps = ComponentProps<"img">;

function resolveMediaSrc(
  props: MarkdownViewProps,
  href: string | undefined,
): string | undefined {
  if (!href || /^(https?:|data:|blob:)/i.test(href)) return href;
  if (props.mode === "workspace") {
    return resolveMarkdownAssetHref(props.workspaceId, props.notePath, href) ?? href;
  }
  return publicShareAssetApiUrl(props.shareToken, props.notePath, href) ?? href;
}

export const MarkdownView = observer(function MarkdownView(props: MarkdownViewProps) {
  const { source, className } = props;
  const colorMode = themeStore.resolved;

  const body = useMemo(() => source.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""), [source]);

  const components = useMemo(
    () => ({
      img: ({ src, alt, ...rest }: MarkdownImgProps) => (
        <img src={resolveMediaSrc(props, src)} alt={alt ?? ""} loading="lazy" {...rest} />
      ),
      video: ({ src, ...rest }: ComponentProps<"video">) => (
        <video controls src={resolveMediaSrc(props, src)} {...rest} />
      ),
      audio: ({ src, ...rest }: ComponentProps<"audio">) => (
        <audio controls src={resolveMediaSrc(props, src)} {...rest} />
      ),
      a: ({ href, children, ...rest }: ComponentProps<"a">) => {
        const resolved = href ? resolveMediaSrc(props, href) : href;
        const external = resolved && /^(https?:)/i.test(resolved);
        return (
          <a
            href={resolved}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer noopener" : undefined}
            {...rest}
          >
            {children}
          </a>
        );
      },
    }),
    [props],
  );

  return (
    <div className={cn(MARKDOWN_COLUMN_CLASS, className)}>
      <MarkdownPreview
        source={body}
        components={components}
        wrapperElement={{ "data-color-mode": colorMode }}
        style={{ backgroundColor: "transparent" }}
        className="!bg-transparent [&_.wmde-markdown]:!bg-transparent [&_.wmde-markdown]:text-[15px] [&_.wmde-markdown]:leading-relaxed"
      />
    </div>
  );
});
