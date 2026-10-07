/**
 * PDF settings, rendered inside the popup (PROJECT.md §8).
 *
 * The popup's main view keeps the two rows that decide what Export PDF does -
 * single long page, and one click versus the print dialog. This is the rest of
 * the PDF settings, the ones that are normally set once: the cog beside
 * "Export PDF" opens it without a trip to the options page.
 *
 * Nothing here is duplicated from the popup's main view. Everything writes
 * through stores/drafts.ts, so the options page - which renders the same
 * settings at more length - and this view are the same two fields over one
 * storage key, never two sources of truth.
 */

import { ChevronLeft, ExternalLink } from "lucide-react";

import { SettingRow } from "@/components/setting-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { PrepOptions } from "@/lib/types";
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
import { settings } from "@/stores/settings";

/**
 * Every pre-processing toggle, in the same order as the options page.
 *
 * All of them, because the popup's main view no longer carries any: it is the
 * surface for exporting this page, and a settings row on it was only ever a
 * shortcut to something set once. The options page groups these by what they
 * affect - PDF and image, versus PDF alone - which is a distinction worth
 * drawing on a full page and not worth two headings in a 336px panel.
 */
const TOGGLES: Array<{
  name: keyof PrepOptions;
  label: string;
  description: string;
}> = [
  {
    name: "hideSticky",
    label: "Hide sticky bars",
    description: "Headers, cookie banners, chat widgets",
  },
  {
    name: "expandDetails",
    label: "Expand collapsed sections",
    description: "Opens every <details> block",
  },
  {
    name: "unlockScrollContainers",
    label: "Un-clip scrollable areas",
    description: "Only containers whose content is cut off",
  },
  {
    name: "loadLazyImages",
    label: "Load lazy images",
    description: "Scrolls the page first so nothing is blank",
  },
  {
    name: "addHeader",
    label: "Add title and URL header",
    description: "A small block at the top of the PDF",
  },
  {
    name: "exactColors",
    label: "Keep backgrounds and colours",
    description: "print-color-adjust: exact, so dark themes survive",
  },
];

export interface PdfSettingsProps {
  /** Back to the export view. */
  onBack: () => void;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-muted-foreground mb-2 text-[11px] font-medium">
      {children}
    </p>
  );
}

export function PdfSettings({ onBack }: PdfSettingsProps) {
  const current = settings.value;
  const disabled = current === null;

  return (
    <div>
      <header className="mb-3 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 px-2"
          onClick={onBack}
          aria-label="Back to export"
        >
          <ChevronLeft />
        </Button>
        <h2 className="text-sm font-semibold">PDF settings</h2>
        <span className="text-muted-foreground ml-auto text-[11px]">
          {savedFlash.value ? "Saved" : ""}
        </span>
      </header>

      {/*
        Chrome caps a popup at 600px and then scrolls the whole thing, which
        would take the back button with it. Scroll the fields instead and leave
        the header where the user can always reach it. The fields come to ~480px,
        so nothing scrolls in practice - the cap is what keeps the header put if
        that ever changes.
      */}
      <div className="scrollbar-subtle max-h-[500px] overflow-y-auto pr-1.5">
        <div className="grid gap-3">
          {TOGGLES.map(({ name, label, description }) => (
            <div key={name} className="grid gap-3">
              <SettingRow
                id={`pdf-${name}`}
                label={label}
                description={description}
                checked={current ? (current.prep[name] as boolean) : false}
                disabled={disabled}
                onCheckedChange={(checked) => {
                  void saveToggle({
                    prep: { [name]: checked } as Partial<PrepOptions>,
                  });
                }}
              />
              {/* The threshold means nothing away from the toggle it qualifies. */}
              {name === "hideSticky" ? (
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="stickyMinHeight"
                    className="text-muted-foreground font-normal"
                  >
                    Ignore anything shorter than
                  </Label>
                  <Input
                    id="stickyMinHeight"
                    type="number"
                    min={0}
                    max={2000}
                    step={1}
                    className="h-8 w-16"
                    value={stickyMinHeightDraft.value}
                    disabled={disabled}
                    onInput={(event) => {
                      stickyMinHeightDraft.value = (
                        event.target as HTMLInputElement
                      ).value;
                    }}
                    onChange={saveDraftsNow}
                    onBlur={saveDraftsNow}
                  />
                  <span className="text-muted-foreground text-sm">px</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <Separator className="my-3" />

        <SectionLabel>Filename</SectionLabel>
        <Input
          aria-label="Filename template"
          spellcheck={false}
          className="font-mono text-xs"
          value={filenameDraft.value}
          disabled={disabled}
          onInput={(event) => {
            filenameDraft.value = (event.target as HTMLInputElement).value;
            saveDraftsSoon();
          }}
        />
        {/* Tokens are listed in full on the options page; this is the short set. */}
        <p className="text-muted-foreground mt-1.5 text-xs">
          <code>{"{title}"}</code> <code>{"{host}"}</code>{" "}
          <code>{"{date}"}</code> <code>{"{time}"}</code>
        </p>
        {/*
          The name *this* page would be saved as, not a sample - the popup hands
          the real tab to the preview (stores/drafts.ts). A page title runs long
          and its filename runs longer, so it is clamped to two lines with the
          whole thing in the tooltip rather than being allowed to push the panel
          around.
        */}
        <p
          className="text-muted-foreground mt-1 flex gap-1 text-xs"
          title={filenamePreview.value}
        >
          <span aria-hidden>&rarr;</span>
          <span className="text-foreground line-clamp-2 font-mono break-all">
            {filenamePreview.value}
          </span>
        </p>

        <Separator className="my-3" />

        <SectionLabel>Always hide these</SectionLabel>
        <Textarea
          aria-label="Selectors to always hide"
          rows={3}
          spellcheck={false}
          className="font-mono text-xs"
          placeholder={".newsletter-modal\n#onetrust-banner-sdk"}
          value={hideSelectorsDraft.value}
          disabled={disabled}
          onInput={(event) => {
            hideSelectorsDraft.value = (
              event.target as HTMLTextAreaElement
            ).value;
            saveDraftsSoon();
          }}
        />
        <p className="text-muted-foreground mt-1.5 text-xs">
          One CSS selector per line. Restored after printing.
        </p>

        <Separator className="my-3" />

        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground -ml-2 h-7 text-xs"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          All settings, screenshots and licence
          <ExternalLink />
        </Button>
      </div>
    </div>
  );
}
