import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

import {
  cssPackageImports,
  findPackage,
  packageRoot,
  readNotice,
  renderNotices,
  type Notice,
} from "./scripts/third-party-licenses";

/**
 * Package roots the entrypoint builds shipped, gathered by the plugin added in
 * `vite:build:extendConfig` and read in `build:publicAssets` once every build
 * has finished (scripts/third-party-licenses.ts).
 */
const shipped = new Set<string>();

// Pinned to wxt ~0.20.x on purpose (see PROJECT.md §2). Do not float to @latest:
// 0.21 moves entrypoint helpers again, and this code is written against 0.20.
export default defineConfig({
  manifest: {
    // The store lists an extension under its manifest name, so the words people
    // search for ("save page as PDF") ride along with the brand.
    name: "Hardcopy - Save Page as PDF",
    short_name: "Hardcopy",
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
    "build:before": () => {
      shipped.clear();
    },

    // One Vite build per entrypoint group; each records the packages whose code
    // it actually emitted.
    "vite:build:extendConfig": (_entrypoints, config) => {
      config.plugins = [
        ...(config.plugins ?? []),
        {
          name: "pagepdf:shipped-packages",
          generateBundle(_options, bundle) {
            for (const output of Object.values(bundle)) {
              if (output.type !== "chunk") continue;
              for (const [id, module] of Object.entries(output.modules)) {
                // Imported, but tree-shaken to nothing: none of it ships.
                if (module.renderedLength === 0) continue;
                const root = packageRoot(id);
                if (root) shipped.add(root);
              }
            }
            // Our own stylesheets' `@import "tailwindcss"` and friends, which
            // Tailwind resolves itself and the module graph never sees.
            for (const id of this.getModuleIds()) {
              const file = id.replace(/[?#].*$/, "");
              if (!file.endsWith(".css") || packageRoot(file) !== null) continue;
              let css: string;
              try {
                css = readFileSync(file, "utf8");
              } catch {
                continue;
              }
              for (const name of cssPackageImports(css)) {
                const root = findPackage(dirname(file), name);
                if (root) shipped.add(root);
              }
            }
          },
        },
      ];
    },

    "build:publicAssets": (wxt, files) => {
      // FSL covers "each version of the software that we make available under
      // these Terms and Conditions, as indicated by our inclusion of these
      // Terms and Conditions with the Software" - so the licence ships inside
      // every build, not only in the repo. Each published version turns MIT
      // two years after its release.
      files.push({
        absoluteSrc: resolve(wxt.config.root, "LICENSE.md"),
        relativeDest: "LICENSE.md",
      });

      // `pnpm dev` serves the popup and options pages from the dev server
      // rather than building them, so the set is missing their packages there.
      // No notices file beats a quietly incomplete one.
      if (wxt.config.command === "serve") return;

      const notices = [...shipped]
        .map(readNotice)
        .filter((notice): notice is Notice => notice !== null);
      const bare = notices.filter((notice) => notice.text === undefined);
      if (bare.length > 0) {
        wxt.logger.warn(
          `No licence file shipped by ${bare.map((n) => n.name).join(", ")}: ` +
            "THIRD_PARTY_LICENSES.txt names their licence but cannot quote it. Copy " +
            "each one's licence from its repository into scripts/licenses/ and list " +
            "it in UPSTREAM_LICENSES (scripts/third-party-licenses.ts).",
        );
      }
      files.push({ relativeDest: "THIRD_PARTY_LICENSES.txt", contents: renderNotices(notices) });
    },
  },

  vite: () => ({
    // @preact/preset-vite aliases react and react-dom to preact/compat, which
    // is what lets shadcn's React components and Radix run on Preact.
    plugins: [preact(), tailwindcss()],
  }),
});
