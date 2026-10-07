import { resolve } from "node:path";

import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// Pinned to wxt ~0.20.x on purpose (see PROJECT.md §2). Do not float to @latest:
// 0.21 moves entrypoint helpers again, and this code is written against 0.20.
export default defineConfig({
  manifest: {
    name: "pagepdf",
    short_name: "pagepdf",
    description:
      "Save any page as a PDF with real, searchable text that looks like the screen. Free, unlimited, no nagging.",

    // --- Permissions -------------------------------------------------------
    //   activeTab  - reach the tab the user clicked on, with no host permissions
    //   scripting  - inject the DOM pre-processing script on demand
    //   storage    - settings and licence (sync), drawing bar prefs (local)
    //   debugger   - one-click PDF export and screenshots: Page.printToPDF,
    //                Emulation.setEmulatedMedia and Page.captureScreenshot,
    //                attached during an export and detached immediately after.
    //                Required rather than optional because Chrome forbids
    //                `debugger` as an optional permission. The print-dialog
    //                path never attaches it.
    //   downloads  - save the PDF the one-click path and screenshots produce.
    //   offscreen  - service workers cannot create Blob URLs (§10.1).
    permissions: [
      "activeTab",
      "scripting",
      "storage",
      "debugger",
      "downloads",
      "offscreen",
    ],
    // --- Keyboard shortcuts ------------------------------------------------
    // Four commands, four suggested keys, which is exactly Chrome's ceiling:
    // it auto-assigns at most four per extension and leaves the rest unbound.
    // Every one of them is rebindable (and unbindable) by the user at
    // chrome://extensions/shortcuts - suggested_key is a suggestion, and Chrome
    // silently drops any that a browser shortcut already owns.
    //
    // Ctrl+Shift is the conventional extension modifier; the letters are
    // chosen clear of Chrome's own (P is the print dialog, D bookmarks every
    // tab, T reopens one, and so on). No `global: true` anywhere: these act on
    // the page in front of the user and have no business firing when Chrome is
    // not focused.
    commands: {
      "save-pdf": {
        suggested_key: { default: "Ctrl+Shift+S", mac: "Command+Shift+S" },
        description: "Save this page as a PDF",
      },
      "capture-page": {
        suggested_key: { default: "Ctrl+Shift+E", mac: "Command+Shift+E" },
        description: "Screenshot the whole page",
      },
      "capture-area": {
        suggested_key: { default: "Ctrl+Shift+X", mac: "Command+Shift+X" },
        description: "Screenshot part of the page",
      },
      draw: {
        suggested_key: { default: "Ctrl+Shift+K", mac: "Command+Shift+K" },
        description: "Draw on this page",
      },
    },

    host_permissions: [],

    // Offscreen documents landed in 109; nothing here needs anything newer.
    minimum_chrome_version: "109",

    // action.default_title comes from the popup entrypoint's <title>, and
    // options_ui.open_in_tab from a meta tag in the options entrypoint - WXT
    // derives both from the HTML, so setting them here would be ignored.
  },

  // Firefox gets its own path later (tabs.saveAsPDF) - PROJECT.md §1.
  browser: "chrome",

  hooks: {
    // FSL covers "each version of the software that we make available under
    // these Terms and Conditions, as indicated by our inclusion of these Terms
    // and Conditions with the Software" - so the licence ships inside every
    // build, not only in the repo. Each published version turns MIT two years
    // after its release.
    "build:publicAssets": (wxt, files) => {
      files.push({
        absoluteSrc: resolve(wxt.config.root, "LICENSE.md"),
        relativeDest: "LICENSE.md",
      });
    },
  },

  vite: () => ({
    // @preact/preset-vite aliases react and react-dom to preact/compat, which
    // is what lets shadcn's React components and Radix run on Preact.
    plugins: [preact(), tailwindcss()],
  }),
});
