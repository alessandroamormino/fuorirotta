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

/**
 * `Content` senza alcuna classe e senza Portal/Overlay impliciti — per superfici
 * che non sono un dialogo centrato (es. un overlay fullscreen) e che quindi non
 * possono annullare le classi fisse di `Content`.
 *
 * Perche' serve un export separato invece di passare `className` a `Content`:
 * `cn()` in lib/utils.ts e' un join di stringhe senza tailwind-merge (scelta
 * dichiarata in Fase 7, D-09), e l'ordine delle regole nel CSS compilato non
 * segue l'ordine delle classi nell'attributo — `.top-1/2` e `.p-6` vengono
 * generate dopo `.inset-0` e `.p-0` e vincono comunque. Verificato in Fase 9.
 *
 * Usare con `asChild` per innestare il comportamento Radix (focus trap, Escape,
 * ripristino del focus, `aria-modal`) sul proprio elemento, che resta l'unico a
 * portare classi. Il call site deve fornire il proprio Portal e, se lo vuole, il
 * proprio Overlay, e rendere un `Title` (anche `sr-only`) come richiede Radix.
 */
const ContentUnstyled = DialogPrimitive.Content;

export {
  Root,
  Trigger,
  Portal,
  Overlay,
  Content,
  ContentUnstyled,
  Close,
  Title,
  Description,
};
