/**
 * A small dialog, deliberately *not* Radix.
 *
 * shadcn's dialog is built on @radix-ui/react-dialog, which does not mount
 * under preact/compat here: its modal machinery (scroll locking and
 * aria-hiding) calls `getComputedStyle` with a non-Element - a ref that compat
 * resolves to something other than a DOM node - and the content never commits.
 * `modal={false}` does not avoid it either. Every other Radix component in this
 * project is fine; this one is the exception.
 *
 * A popup 336px wide needs none of what Radix's dialog provides - no portal, no
 * scroll lock, no focus trap worth the dependency - so this keeps the shadcn
 * API and appearance with plain elements: overlay click and Escape to close.
 */

import { XIcon } from "lucide-react";
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { cn } from "cn";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ComponentChildren;
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;
  return <>{children}</>;
}

export interface DialogContentProps {
  children: ComponentChildren;
  className?: string;
  onOpenChange: (open: boolean) => void;
  showCloseButton?: boolean;
}

function DialogContent({
  children,
  className,
  onOpenChange,
  showCloseButton = true,
}: DialogContentProps) {
  return (
    <div data-slot="dialog" className="fixed inset-0 z-50 flex items-center justify-center p-3">
      <div
        data-slot="dialog-overlay"
        className="animate-in fade-in-0 absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />
      <div
        data-slot="dialog-content"
        role="dialog"
        aria-modal="true"
        className={cn(
          "bg-background animate-in fade-in-0 zoom-in-95 scrollbar-subtle relative z-10 grid max-h-full w-full gap-4 overflow-y-auto rounded-lg border p-5 shadow-lg",
          className,
        )}
      >
        {children}
        {showCloseButton ? (
          <button
            type="button"
            data-slot="dialog-close"
            onClick={() => onOpenChange(false)}
            className="focus-visible:ring-ring absolute top-3 right-3 cursor-pointer rounded-xs opacity-60 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:outline-hidden [&_svg]:size-4 [&_svg]:shrink-0"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DialogHeader({ className, ...props }: { className?: string; children: ComponentChildren }) {
  return (
    <div data-slot="dialog-header" className={cn("grid gap-1.5 pr-6 text-left", className)} {...props} />
  );
}

function DialogFooter({ className, ...props }: { className?: string; children: ComponentChildren }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: { className?: string; children: ComponentChildren }) {
  return (
    <h2
      data-slot="dialog-title"
      className={cn("text-base leading-none font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: {
  className?: string;
  children: ComponentChildren;
}) {
  return (
    <p
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle };
