/**
 * Options page (PROJECT.md §8, weekend 1).
 *
 * Everything saves as you type, debounced. There is no Save button to forget.
 *
 * The print settings are grouped by what they actually affect, because the two
 * outputs do not share the same pipeline: the pre-processing pass runs for a PDF
 * and for a full-page screenshot alike, while the injected stylesheet is
 * `media="print"` (lib/dom/print-css.ts) and a screenshot never matches it. A
 * setting in the wrong group is a setting the user will fiddle with and see no
 * effect from.
 */

import { cn } from "cn";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "preact/hooks";

import { LicenseForm } from "@/components/license-form";
import { ProDialog } from "@/components/pro-dialog";
import { SettingRow } from "@/components/setting-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { ImageFormat, PrepOptions } from "@/lib/types";
import {
  filenameDraft,
  filenamePreview,
  hideSelectorsDraft,
  saveDraftsNow,
  saveDraftsSoon,
  savedFlash,
  saveToggle,
  stickyMinHeightDraft,
} from "@/stores/drafts";
import { setExportMode, setImageFormat, setSinglePage, settings } from "@/stores/settings";
import { initOptions, resetAll } from "./store";

interface Toggle {
  name: keyof PrepOptions;
  label: string;
  description: string;
}

/**
 * Pre-processing: the pass that changes the page itself, so it lands in the PDF
 * and in a full-page screenshot equally (`handleCapture` in
 * entrypoints/background.ts hands it the same options).
 */
const SHARED_TOGGLES: Toggle[] = [
  {
    name: "hideSticky",
    label: "Hide sticky and fixed bars",
    description:
      "Headers, cookie banners, chat widgets. Chrome repaints fixed elements on every sheet, so this is usually what you want.",
  },
  {
    name: "expandDetails",
    label: "Expand collapsed sections",
    description: "Opens every <details> element, then closes them again afterwards.",
  },
  {
    name: "unlockScrollContainers",
    label: "Un-clip scrollable areas",
    description: "Only touches containers whose content is actually cut off.",
  },
  {
    name: "loadLazyImages",
    label: "Load lazy images",
    description:
      "Scrolls to the bottom in steps to trigger lazy loaders, then scrolls back. Gives up after 8 seconds.",
  },
  {
    name: "addHeader",
    label: "Add a title / URL / date header",
    description: "A small block prepended to the page.",
  },
];

/** Rules that only exist inside the print stylesheet. */
const PDF_TOGGLES: Toggle[] = [
  {
    name: "exactColors",
    label: "Keep backgrounds and colours",
    description:
      'Sets print-color-adjust: exact, so dark themes and coloured blocks survive. With the print dialog you still need to tick "Background graphics" in it.',
  },
];

/** Screenshot encodings, smallest output first. */
const FORMATS: Array<{ value: ImageFormat; label: string; hint: string }> = [
  { value: "webp", label: "WebP", hint: "Smallest, no visible loss. Opens everywhere." },
  { value: "jpeg", label: "JPEG", hint: "Almost as small, and the most universally accepted." },
  { value: "png", label: "PNG", hint: "Lossless and much larger - a long page runs to tens of MB." },
];

function SectionTitle({ children }: { children: string }) {
  return (
    <CardTitle className="text-xs font-semibold tracking-wide uppercase">{children}</CardTitle>
  );
}

/**
 * One pre-processing toggle. Reads the settings signal itself so both groups can
 * render a row without threading state through, and carries the sticky
 * threshold, which means nothing away from the toggle it qualifies.
 */
function PrepToggle({ name, label, description }: Toggle) {
  const current = settings.value;

  return (
    <div className="grid gap-4">
      <SettingRow
        id={name}
        label={label}
        description={description}
        checked={current ? (current.prep[name] as boolean) : false}
        disabled={current === null}
        onCheckedChange={(checked) => {
          void saveToggle({ prep: { [name]: checked } as Partial<PrepOptions> });
        }}
      />
      {name === "hideSticky" ? (
        <div className="flex items-center gap-2 pl-0.5">
          <Label htmlFor="stickyMinHeight" className="text-muted-foreground font-normal">
            Ignore anything shorter than
          </Label>
          <Input
            id="stickyMinHeight"
            type="number"
            min={0}
            max={2000}
            step={1}
            className="h-8 w-20"
            value={stickyMinHeightDraft.value}
            disabled={current === null}
            onInput={(event) => {
              stickyMinHeightDraft.value = (event.target as HTMLInputElement).value;
            }}
            onChange={saveDraftsNow}
            onBlur={saveDraftsNow}
          />
          <span className="text-muted-foreground text-sm">px</span>
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  const [proOpen, setProOpen] = useState(false);

  useEffect(() => {
    void initOptions();
  }, []);

  const current = settings.value;
  const printDialog = current?.exportMode === "print";

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 pb-14">
      <h1 className="text-xl font-semibold">pagepdf settings</h1>
      <p className="text-muted-foreground mt-1 mb-6 text-sm">
        These are the defaults for every export. The popup's two toggles are the same settings
        and stay in sync with this page.
      </p>

      <Card className="mb-6 gap-4 py-5">
        <CardHeader className="px-5">
          <SectionTitle>PDF &amp; Image print</SectionTitle>
          <CardDescription>
            The page is prepared the same way for both outputs, so everything here shows up in
            the PDF and in a full-page screenshot. "Select area" is the exception: it captures
            the rectangle you drew exactly as it is on screen and touches nothing first.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-5">
          {SHARED_TOGGLES.map((toggle) => (
            <PrepToggle key={toggle.name} {...toggle} />
          ))}

          <Separator />

          <div className="grid gap-2">
            <Label htmlFor="hideSelectors">Always hide these</Label>
            <Textarea
              id="hideSelectors"
              rows={4}
              spellcheck={false}
              className="font-mono text-xs"
              placeholder={".newsletter-modal\n#onetrust-banner-sdk"}
              value={hideSelectorsDraft.value}
              disabled={current === null}
              onInput={(event) => {
                hideSelectorsDraft.value = (event.target as HTMLTextAreaElement).value;
                saveDraftsSoon();
              }}
            />
            <p className="text-muted-foreground text-xs">
              One CSS selector per line. Hidden regardless of size or position, and restored
              afterwards.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6 gap-4 py-5">
        <CardHeader className="px-5">
          <SectionTitle>PDF print</SectionTitle>
          <CardDescription>
            Only the PDF. These go into the injected{" "}
            <code className="text-xs">&lt;style media="print"&gt;</code> or into the paper size
            itself, neither of which a screenshot ever sees.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-5">
          {PDF_TOGGLES.map((toggle) => (
            <PrepToggle key={toggle.name} {...toggle} />
          ))}

          <SettingRow
            id="printDialog"
            label="Use Chrome's print dialog"
            description="Off: one click saves the page as it looks on screen, straight to Downloads, and Chrome shows a yellow debugging bar while it runs. On: Chrome's print dialog opens instead, with the site's print styles and no debugging bar."
            checked={printDialog}
            disabled={current === null}
            onCheckedChange={(checked) => void setExportMode(checked ? "print" : "screen")}
          />

          {/*
            One-click only - see the note in the popup's App.tsx. Disabled
            rather than hidden while the print dialog is chosen just above.
          */}
          <SettingRow
            id="singlePage"
            label="Save the whole page as one long page"
            description="One continuous page with no page breaks, however tall the page is. Not with the print dialog: it always paginates to the paper size picked in it."
            checked={current?.pageMode === "single" && !printDialog}
            disabled={current === null || printDialog}
            onCheckedChange={(checked) => void setSinglePage(checked)}
          />
        </CardContent>
      </Card>

      <Card className="mb-6 gap-4 py-5">
        <CardHeader className="px-5">
          <SectionTitle>Image print</SectionTitle>
          <CardDescription>
            Only the screenshot buttons. A full-page shot of a long page is a big picture: as PNG
            it can run past 50MB, which is more than the browser will even carry from one part of
            the extension to another.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 px-5">
          <div
            role="radiogroup"
            aria-label="Screenshot format"
            className="bg-muted inline-flex w-fit gap-0.5 rounded-lg p-0.5"
          >
            {FORMATS.map(({ value, label }) => {
              const active = current?.imageFormat === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={current === null}
                  onClick={() => void setImageFormat(value)}
                  className={cn(
                    "cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
                    active
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-muted-foreground text-sm">
            {FORMATS.find(({ value }) => value === current?.imageFormat)?.hint ?? " "}
          </p>
        </CardContent>
      </Card>

      <Card className="mb-6 gap-3 py-5">
        <CardHeader className="px-5">
          <SectionTitle>Filename</SectionTitle>
          <CardDescription>
            Used by both outputs - a screenshot is named from the same template, with its own
            extension. Tokens: <code className="text-xs">{"{title}"}</code>{" "}
            <code className="text-xs">{"{host}"}</code> <code className="text-xs">{"{date}"}</code>{" "}
            <code className="text-xs">{"{time}"}</code>{" "}
            <code className="text-xs">{"{datetime}"}</code>. Illegal characters are stripped and the
            name is capped at 120 characters.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 px-5">
          <Input
            aria-label="Filename template"
            spellcheck={false}
            className="font-mono text-sm"
            value={filenameDraft.value}
            disabled={current === null}
            onInput={(event) => {
              filenameDraft.value = (event.target as HTMLInputElement).value;
              saveDraftsSoon();
            }}
          />
          <p className="text-muted-foreground text-xs">
            Preview: <span className="text-foreground font-mono">{filenamePreview.value}</span>
          </p>
        </CardContent>
      </Card>

      <Card className="mb-6 gap-3 py-5">
        <CardHeader className="px-5">
          <SectionTitle>Pro licence</SectionTitle>
          <CardDescription>
            A one-time $5 key unlocks Draw mode: pencil, highlighter, shapes, covers that
            remove text, symbols and text labels. Everything else is free. No account and no
            subscription.{" "}
            <button
              type="button"
              onClick={() => setProOpen(true)}
              className="text-primary cursor-pointer hover:underline"
            >
              What's in Pro?
            </button>
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          <LicenseForm />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => void resetAll()} disabled={current === null}>
          <RotateCcw />
          Reset to defaults
        </Button>
        <span className="text-muted-foreground text-sm">{savedFlash.value ? "Saved" : ""}</span>
      </div>

      <p className="text-muted-foreground mt-8 text-xs">
        Everything happens in your browser. No server, no analytics, no telemetry, no account.
        Settings are stored in your Chrome profile so they follow you across devices.
      </p>

      <ProDialog open={proOpen} onOpenChange={setProOpen} />
    </main>
  );
}
