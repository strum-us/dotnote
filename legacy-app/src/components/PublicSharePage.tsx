import { useEffect, useRef, useState } from "react";

import { DotnoteMark } from "@/components/DotnoteMark";
import { MarkdownView } from "@/components/MarkdownView";
import { publicShareGet } from "@/lib/api";
import type { PublicSharePayload } from "@shared/types";

const HEADER_HEIGHT_PX = 40;
const HEADER_FADE_SCROLL_PX = 48;

export function PublicSharePage({ token }: { token: string }) {
  const [payload, setPayload] = useState<PublicSharePayload | null>(null);
  const [missing, setMissing] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    void publicShareGet(token)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!payload) return;

    let frame: number | null = null;

    const step = () => {
      frame = null;
      const el = headerRef.current;
      if (!el) return;
      const t = Math.min(1, window.scrollY / HEADER_FADE_SCROLL_PX);
      el.style.opacity = String(1 - t);
      el.style.transform = `translateY(${(-8 * t).toFixed(2)}px)`;
      el.style.pointerEvents = t > 0.9 ? "none" : "";
    };

    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(step);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    step();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [payload]);

  if (missing) {
    return (
      <div className="flex min-h-full items-center justify-center bg-well px-6 text-sm text-dim">
        This shared page is unavailable.
      </div>
    );
  }

  if (!payload) {
    return <div className="min-h-full bg-well" aria-hidden />;
  }

  return (
    <div className="min-h-full bg-well text-ink">
      <div style={{ height: HEADER_HEIGHT_PX }} aria-hidden />
      <header
        ref={headerRef}
        className="fixed inset-x-0 top-0 z-10 border-b border-divider bg-well will-change-[opacity,transform]"
      >
        <div className="flex h-10 w-full items-center gap-2.5 px-4">
          <DotnoteMark />
          <h1 className="min-w-0 truncate text-[15px] font-normal leading-snug">{payload.title}</h1>
        </div>
      </header>
      <main className="pb-16">
        <MarkdownView mode="share" shareToken={token} notePath={payload.notePath} source={payload.markdown} />
      </main>
    </div>
  );
}
