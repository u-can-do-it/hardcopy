/**
 * Popup: export this page (PROJECT.md §8, weekend 1 - which specified four
 * toggles here; they now live one tap away instead).
 *
 * The main view is the actions - Export PDF, Draw, the two screenshot buttons -
 * plus the two rows that decide what Export PDF does: single long page, and
 * one click versus the print dialog. Every pre-processing setting is behind
 * the cog (components/pdf-settings.tsx) and on the options page.
 *
 * Draw is the one Pro feature. Its button stays visible with a badge, and a tap
 * without a key explains Pro instead of starting annotate mode.
 *
 * Everything writes straight through to storage.sync, so the popup closing
 * mid-fiddle never loses a setting.
 */

import { Camera, Cog, Crop, FileDown, Pencil, Settings2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "preact/hooks";

import { PdfSettings } from "@/components/pdf-settings";
import { ProDialog } from "@/components/pro-dialog";
import { SettingRow } from "@/components/setting-row";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { setExportMode, setSinglePage, settings } from "@/stores/settings";
import {
  blocked,
  busy,
  controlsDisabled,
  exportDisabled,
  initPopup,
  pro,
  runCapture,
  runExport,
  showView,
  startAnnotate,
  status,
  tab,
  view,
} from "./store";

export function App() {
  const [proOpen, setProOpen] = useState(false);

  useEffect(() => {
    void initPopup();
  }, []);

  const current = settings.value;
  const state = status.value;
  const onExport = view.value === "export";
  const printDialog = current?.exportMode === "print";

  return (
    <div className="w-[336px] p-4">
      {/*
        Both panels stay mounted, and the one that is not showing is `hidden` -
        the settings panel holds text fields with debounced, not-yet-saved
        drafts, and stepping back to the export button should not be a way to
        lose them. It also keeps the popup's width from reflowing on the switch.
      */}
      <div hidden={!onExport}>
        <header className="mb-3">
          <h1 className="text-sm font-semibold">Save page as PDF</h1>
          <p className="text-muted-foreground mt-0.5 truncate text-xs" title={tab.value?.title ?? ""}>
            {tab.value?.title ?? " "}
          </p>
        </header>

        {blocked.value ? (
          <Alert variant="warning" className="mb-3">
            <TriangleAlert />
            <AlertDescription className="text-warning-foreground">{blocked.value}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3">
          {/*
            One-click only, and not by choice: Chrome's print dialog takes its
            paper size from its own dropdown and discards `@page { size }`, so
            the `window.print()` path cannot produce one tall sheet. Verified on
            Chrome 152 - the same document through printToPDF is 1 page of
            10.42x31.25in, through the dialog it is N Letter pages. So the row
            is disabled rather than hidden while the print dialog is chosen,
            with the reason in its description and the cause right below it.
          */}
          <SettingRow
            id="singlePage"
            label="Single long page"
            description={
              printDialog
                ? "Not with the print dialog - it always paginates"
                : "One tall page instead of A4 sheets"
            }
            checked={current?.pageMode === "single" && !printDialog}
            disabled={controlsDisabled.value || printDialog}
            onCheckedChange={(checked) => void setSinglePage(checked)}
          />
          <SettingRow
            id="printDialog"
            label="Use the print dialog"
            description="The site's print styles, and no debugging bar"
            checked={printDialog}
            disabled={controlsDisabled.value}
            onCheckedChange={(checked) => void setExportMode(checked ? "print" : "screen")}
          />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button
            className="flex-1"
            disabled={exportDisabled.value}
            onClick={() => void runExport()}
          >
            <FileDown />
            {busy.value ? "Preparing..." : "Export PDF"}
          </Button>
          {/*
            The settings that shape the PDF, one tap from the button that makes
            it. Not disabled with the export button: a page that cannot be
            exported at all is exactly when someone goes looking at the settings.
          */}
          <Button
            variant="outline"
            size="icon"
            aria-label="PDF settings"
            title="PDF settings"
            onClick={() => showView("settings")}
          >
            <Cog />
          </Button>
        </div>

        {/*
          Under the export button, not with the screenshots: marking the page up
          is a step *before* an export rather than a different kind of output,
          and it reaches all four of them at once - the marks are real SVG in the
          real DOM. Like "Select area" it leaves the popup, because drawing means
          clicking on the page.

          Pro. Without a key the button opens the Pro dialog rather than
          starting a session the background would refuse anyway.
        */}
        <div className="mt-2 flex">
          <Button
            variant="outline"
            className="flex-1"
            disabled={exportDisabled.value}
            onClick={() => {
              if (pro.value) void startAnnotate();
              else setProOpen(true);
            }}
          >
            <Pencil />
            Draw
            {pro.value ? null : (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] uppercase">
                Pro
              </Badge>
            )}
          </Button>
        </div>

        {/*
          Screenshots are the other half of "save this page": a PNG when the point
          is what it looked like, a PDF when the point is the text. "Area" leaves
          the popup - picking a rectangle means clicking on the page, and that
          dismisses the popup either way - so the result is reported in the page.
        */}
        <p className="text-muted-foreground mt-3 mb-1.5 text-[11px] font-medium">Screenshot (PNG)</p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            disabled={exportDisabled.value}
            onClick={() => void runCapture("full")}
          >
            <Camera />
            Full page
          </Button>
          <Button
            variant="outline"
            disabled={exportDisabled.value}
            onClick={() => void runCapture("region")}
          >
            <Crop />
            Select area
          </Button>
        </div>

        <p
          role="status"
          aria-live="polite"
          className={`mt-2.5 min-h-8 text-xs leading-snug ${
            state.kind === "error" ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {state.kind === "hint" ? (
            printDialog ? (
              <>
                In the dialog, pick <b className="text-foreground font-medium">Save as PDF</b> and
                tick <b className="text-foreground font-medium">Background graphics</b>.
              </>
            ) : (
              <>
                Saves straight to <b className="text-foreground font-medium">Downloads</b>. Chrome
                shows a yellow debugging bar while it runs.
              </>
            )
          ) : (
            state.text
          )}
        </p>

        <Separator className="my-2" />

        <footer className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground -ml-2 h-7 text-xs"
            onClick={() => chrome.runtime.openOptionsPage()}
          >
            <Settings2 />
            Settings
          </Button>
          <button
            type="button"
            onClick={() => setProOpen(true)}
            className="text-muted-foreground hover:text-foreground cursor-pointer text-[11px] transition-colors"
          >
            Free &middot; unlimited &middot; <span className="underline">Pro?</span>
          </button>
        </footer>
      </div>

      <div hidden={onExport}>
        <PdfSettings onBack={() => showView("export")} />
      </div>

      <ProDialog open={proOpen} onOpenChange={setProOpen} />
    </div>
  );
}
