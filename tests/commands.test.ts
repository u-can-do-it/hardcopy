import { describe, expect, it } from "vitest";
import {
  commandToast,
  isCommandName,
  requestForCommand,
  type CommandName,
} from "@/lib/commands";
import { fail, type BgResponse } from "@/lib/messages";
import type { PrepReport } from "@/lib/types";
import config from "@/wxt.config";

const REPORT: PrepReport = {
  hiddenElements: 0,
  detailsOpened: 0,
  containersUnlocked: 0,
  imagesForced: 0,
  warnings: [],
};

const ALL: CommandName[] = ["save-pdf", "capture-page", "capture-area", "draw"];

describe("isCommandName", () => {
  it("accepts the four commands in the manifest", () => {
    for (const name of ALL) expect(isCommandName(name), name).toBe(true);
  });

  it("drops anything else, including a binding left over from an old build", () => {
    for (const name of ["_execute_action", "save-png", "", "save-pdf "]) {
      expect(isCommandName(name), name).toBe(false);
    }
  });
});

describe("requestForCommand", () => {
  it("sends a bare export - the background reads the mode from settings", () => {
    // One click or the print dialog is `settings.exportMode`, and the page mode
    // is `effectivePageMode`; both are resolved inside the export, so the
    // shortcut can never drift from the popup's button.
    expect(requestForCommand("save-pdf")).toEqual({ type: "EXPORT" });
  });

  it("maps the two screenshots and the drawing bar", () => {
    expect(requestForCommand("capture-page")).toEqual({ type: "CAPTURE", area: "full" });
    expect(requestForCommand("capture-area")).toEqual({ type: "CAPTURE", area: "region" });
    expect(requestForCommand("draw")).toEqual({ type: "ANNOTATE", action: "start" });
  });
});

describe("commandToast", () => {
  const capture = (area: "full" | "region"): BgResponse => ({
    ok: true,
    kind: "capture",
    area,
    filename: "page.webp",
    size: { width: 800, height: 600 },
    scale: 1,
  });

  it("stays quiet when the page already shows what happened", () => {
    // The print dialog is its own announcement...
    expect(
      commandToast("save-pdf", { ok: true, mode: "print", printRequested: true, report: REPORT }),
    ).toBeNull();
    // ...so is the drawing bar appearing...
    expect(commandToast("draw", { ok: true, kind: "annotate", active: true })).toBeNull();
    // ...and handleCapture toasts the region path itself.
    expect(commandToast("capture-area", capture("region"))).toBeNull();
  });

  it("names the file the user never saw being written", () => {
    expect(commandToast("capture-page", capture("full"))).toEqual({
      text: "Saved page.webp",
      tone: "done",
    });
    expect(
      commandToast("save-pdf", {
        ok: true,
        mode: "screen",
        printRequested: false,
        report: REPORT,
        filename: "page.pdf",
      }),
    ).toEqual({ text: "Saved page.pdf", tone: "done" });
  });

  it("passes a failure through verbatim - it is written as a sentence already", () => {
    expect(commandToast("save-pdf", fail("RESTRICTED_URL", "Chrome blocks extensions here."))).toEqual(
      { text: "Chrome blocks extensions here.", tone: "error" },
    );
  });

  it("says why the drawing shortcut did nothing on a browser without Pro", () => {
    // Annotate mode is Pro; a keypress answered with silence reads as broken.
    expect(commandToast("draw", fail("PRO_REQUIRED", "Draw mode is a Pro feature."))).toEqual({
      text: "Draw mode is a Pro feature.",
      tone: "error",
    });
  });

  it("says nothing about a drag the user abandoned", () => {
    for (const name of ALL) {
      expect(commandToast(name, fail("CANCELLED", "Area selection was cancelled.")), name).toBeNull();
    }
  });

  /**
   * The bug this guards is worse than a repeated sentence: select-area.ts keeps
   * one removal timer for the toast it has up, and a second toast clears that
   * timer while removing only its own host - so the duplicate is the one that
   * stays on the page until the user navigates away.
   */
  it("leaves a failed region capture to the toast handleCapture already showed", () => {
    const sentence = "Screenshot failed: the tab stopped responding.";
    expect(commandToast("capture-area", fail("CAPTURE_FAILED", sentence))).toBeNull();

    // Only the region path reports itself. The full-page branch of handleCapture
    // has no reportInPage in it, so its failure has to be said here.
    expect(commandToast("capture-page", fail("CAPTURE_FAILED", sentence))).toEqual({
      text: sentence,
      tone: "error",
    });
  });

  it("still speaks for the region failures that happen before the selector is up", () => {
    // NO_TAB and RESTRICTED_URL are returned by handleCapture before it injects
    // anything, so nothing in the page has said them.
    expect(commandToast("capture-area", fail("NO_TAB", "No active tab to capture."))).toEqual({
      text: "No active tab to capture.",
      tone: "error",
    });
    expect(
      commandToast("capture-area", fail("RESTRICTED_URL", "Chrome's own pages are off-limits.")),
    ).toEqual({ text: "Chrome's own pages are off-limits.", tone: "error" });
  });
});

/**
 * The manifest is the other half of this feature and nothing else pins it.
 *
 * The check belongs beside the names it has to agree with. A command in the
 * manifest that `isCommandName` rejects is a keypress that silently does
 * nothing, and the drift is invisible until someone presses the key.
 */
describe("the manifest's commands block", () => {
  // WXT lets `manifest` be an object, a promise or a function. This one is a
  // literal, and a test that quietly passed because it could not see inside a
  // promise would be worse than no test at all.
  const manifest = config.manifest;
  if (typeof manifest !== "object" || manifest === null || "then" in manifest) {
    throw new Error("wxt.config.ts no longer exports a plain manifest object.");
  }
  const commands = manifest.commands ?? {};
  const names = Object.keys(commands);

  it("declares exactly the four names lib/commands.ts knows", () => {
    expect(new Set(names)).toEqual(new Set(ALL));
    for (const name of names) expect(isCommandName(name), name).toBe(true);
  });

  it("stays inside Chrome's ceiling of four suggested keys", () => {
    const suggested = names.filter((name) => commands[name]?.suggested_key !== undefined);
    expect(suggested.length).toBeLessThanOrEqual(4);
  });

  it("gives every command a description - Chrome requires one and shows it", () => {
    for (const name of names) {
      expect(commands[name]?.description?.trim(), name).toBeTruthy();
    }
  });

  it("asks for no global shortcut", () => {
    // A global command fires with Chrome unfocused, arrives with no `tab`, and
    // may only suggest Ctrl+Shift+[0-9]. None of these want any of that.
    for (const name of names) {
      expect(commands[name]).not.toHaveProperty("global");
    }
  });

  it("suggests a mac key wherever it suggests a default one", () => {
    // Chrome does not translate Ctrl to Command; a missing `mac` is a shortcut
    // that ships unbound on half the machines.
    for (const name of names) {
      const key = commands[name]?.suggested_key;
      if (key === undefined) continue;
      // The bare-string shorthand means `default` and nothing else, which is
      // precisely the shape this rejects.
      expect(typeof key, name).not.toBe("string");
      if (typeof key === "string") continue;
      expect(key.default, name).toBeTruthy();
      expect(key.mac, name).toBeTruthy();
    }
  });
});
