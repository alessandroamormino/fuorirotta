"use client";

/**
 * Thin wrapper over @radix-ui/react-dialog — Radix owns focus trap, Escape-to-close,
 * focus restoration to the trigger, and `aria-modal="true"`. This file only adds the
 * token-based surface styling on `Overlay`/`Content`; every other export passes through
 * unmodified.
 *
 * `Title` is required by Radix for screen-reader announcement — every call site must
 * render one. If it should not be visible, use Tailwind's built-in `sr-only` utility
 * class on it (no extra dependency needed for a visually-hidden title).
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

const Root = DialogPrimitive.Root;
const Trigger = DialogPrimitive.Trigger;
const Portal = DialogPrimitive.Portal;
const Close = DialogPrimitive.Close;
const Title = DialogPrimitive.Title;
const Description = DialogPrimitive.Description;

const Overlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function Overlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn("fixed inset-0 z-[200] bg-black/50", className)}
      {...props}
    />
  );
});

const Content = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function Content({ className, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-[200] w-full max-w-lg -translate-x-1/2 -translate-y-1/2",
          "max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-surface p-6 shadow-xl outline-none",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export { Root, Trigger, Portal, Overlay, Content, Close, Title, Description };
