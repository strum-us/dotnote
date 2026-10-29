import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils";

function ContextMenu(props: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root {...props} />;
}

function ContextMenuTrigger(props: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger {...props} />;
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          "z-[100] min-w-[10rem] overflow-hidden rounded-sm border border-divider bg-panel p-0.5 text-ink",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & { variant?: "default" | "destructive" }) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 text-compact outline-none hover:bg-raised focus:bg-raised data-[disabled]:opacity-40",
        variant === "destructive" && "text-danger hover:bg-danger/15 focus:bg-danger/15",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={cn("my-0.5 h-px bg-divider", className)} {...props} />;
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator };
