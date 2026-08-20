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
import { cn } from "@/lib/utils";

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

/**
 * `Content` senza alcuna classe — per superfici che non sono un popover per
 * forma (es. un pannello largo quanto la barra di ricerca, ancorato sotto di
 * essa) e che quindi non possono annullare le classi fisse di `Content`
 * (`z-[200]`, `max-h-[70vh]`, `min-w-[10rem]`, `rounded-lg`, `border-border`,
 * `shadow-xl`, `p-2`).
 *
 * Perche' serve un export separato invece di passare `className` a `Content`:
 * `cn()` in lib/utils.ts e' un join di stringhe senza tailwind-merge (Fase 7,
 * D-09), e l'ordine delle regole nel CSS compilato non segue l'ordine delle
 * classi nell'attributo — le classi di `Content` vincono comunque sulle
 * proprie. Stesso conflitto gia' documentato e risolto in Fase 9 su
 * `Dialog.ContentUnstyled`.
 *
 * Usare con `asChild` per innestare il comportamento Radix (chiusura per
 * click esterno, Escape, ripristino del focus, posizionamento ancorato) sul
 * proprio elemento, che resta l'unico a portare classi. Il call site deve
 * fornire il proprio `Portal`.
 */
const ContentUnstyled = PopoverPrimitive.Content;

export { Root, Trigger, Anchor, Portal, Content, ContentUnstyled, Close };
