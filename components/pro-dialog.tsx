/**
 * What Pro is, shown when someone taps a locked feature (PROJECT.md §6.1).
 *
 * Pro is Draw mode, all of it. Everything else - one-click export, the screen
 * look, single long page, screenshots - is free.
 *
 * §6.3 says the upsell is one quiet row and "never a modal, never a
 * post-export nag". This modal only ever opens from a deliberate tap on a
 * locked control, and never on its own or after an export, so the rule it is
 * there to enforce still holds.
 */

import { Check, ExternalLink } from "lucide-react";

import { LicenseForm } from "@/components/license-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { CHECKOUT_URL, PRO_AVAILABLE } from "@/lib/constants";

const FEATURES: Array<{ title: string; detail: string }> = [
  {
    title: "Draw on the page",
    detail: "Pencil, highlighter, lines, rectangles and ellipses, saved into the PDF or screenshot.",
  },
  {
    title: "Covers that really remove text",
    detail: "Block out a passage and it is gone from the PDF's text, not just painted over.",
  },
  {
    title: "Symbols and numbered pins",
    detail: "Arrows, checks, crosses, exclamation marks, stars, and pins that number themselves.",
  },
  {
    title: "Text labels",
    detail: "Typed in place, and still searchable in the PDF.",
  },
];

export interface ProDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProDialog({ open, onOpenChange }: ProDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Hardcopy Pro</DialogTitle>
          <DialogDescription>
            Draw mode, for one payment of $5. No account and no subscription. Everything
            else stays free and unmetered.
          </DialogDescription>
        </DialogHeader>

        <ul className="grid gap-2.5">
          {FEATURES.map(({ title, detail }) => (
            <li key={title} className="flex gap-2.5">
              <Check className="text-primary mt-0.5 size-4 shrink-0" />
              <div className="grid gap-0.5">
                <span className="text-sm leading-none font-medium">{title}</span>
                <span className="text-muted-foreground text-xs leading-snug">{detail}</span>
              </div>
            </li>
          ))}
        </ul>

        {PRO_AVAILABLE && CHECKOUT_URL ? (
          <Button asChild>
            <a href={CHECKOUT_URL} target="_blank" rel="noreferrer">
              Get Pro - $5
              <ExternalLink />
            </a>
          </Button>
        ) : (
          <p className="text-muted-foreground text-xs">
            Not on sale yet. If you already have a key, you can activate it below.
          </p>
        )}

        <Separator />
        <LicenseForm compact />
      </DialogContent>
    </Dialog>
  );
}
