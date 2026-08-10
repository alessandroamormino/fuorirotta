"use client";

/**
 * Thin wrapper over @radix-ui/react-popover — Radix owns `aria-expanded` on the
 * trigger, Escape-to-close with focus return, roving focus inside list-style content,
 * click-outside dismissal, and anchored positioning. This file only adds the
 * token-based surface styling on `Content`; every other export passes through
 * unmodified.
 *
 * Content deliberately carries no fixed width — list rows composed inside should
 * truncate themselves (e.g. `className="truncate"` on each row) rather than widening
 * the anchored panel. No real list content exists yet (Phase 9/11 call sites); the
 * exact truncation threshold is a backstop, verified visually once real data lands.
 */

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

// ponytail: 5-line class-join, not the lib/utils.ts `cn` helper — that file belongs to
// a sibling plan not yet present in this worktree. Converges on the shared helper once
// the wave merges.
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const Root = PopoverPrimitive.Root;
const Trigger = PopoverPrimitive.Trigger;
const Anchor = PopoverPrimitive.Anchor;
const Portal = PopoverPrimitive.Portal;
const Close = PopoverPrimitive.Close;

const Content = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function Content({ className, sideOffset = 8, children, ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-[200] max-h-[70vh] min-w-[10rem] overflow-y-auto rounded-lg border border-border bg-surface p-2 shadow-xl outline-none",
          className
        )}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
});

export { Root, Trigger, Anchor, Portal, Content, Close };
