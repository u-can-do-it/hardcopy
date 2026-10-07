# Store listing draft (PROJECT.md §11)

Filled in as far as the code allows; the rest needs decisions, not code. Pricing
and the licence key flow are in [LEMON-SQUEEZY.md](LEMON-SQUEEZY.md).

- **Name:** Hardcopy. The manifest name is "Hardcopy - Save Page as PDF", so
  the store title carries the search phrase. "pagepdf" was the working name;
  not "Web to PDF" - three products already use it (§1).
- **Short description (<=132 chars):**
  `Save any page as a PDF with real, searchable text that looks like the screen. Free, unlimited, no nagging.`
  (105 characters.)
- **Single purpose:** Export the current web page to a PDF file.
- **Category:** Productivity
- **Screenshots (3):** popup; before/after showing print CSS versus screen look;
  a page marked up with the drawing tools and the PDF it produced.
- **Privacy tab:** all data handling = "not collected".
- **Trader:** yes - register before charging (§7).

## Permission justifications

**Six permissions ship, all required - there are no optional ones.** One-click
PDF export, the free default, and screenshots both use `debugger` (Deviations 13
and 24), and both write their own files, which is what `downloads` and
`offscreen` are for. Check this list against `wxt.config.ts` before every
submission - it is the one document where being out of date is a false
statement to a reviewer rather than a stale note.

- **activeTab** - runs the page pre-processing (hiding sticky bars, expanding
  collapsed sections, triggering lazy images), and `window.print()` when the
  user has chosen the print dialog, on the single tab the user clicked the
  extension on. No host permissions are requested, so the extension has no
  access to any page until it is clicked.
- **scripting** - injects that one pre-processing script into the clicked tab.
- **storage** - saves the user's own settings, licence key and drawing bar
  preferences. Nothing is sent anywhere.
- **debugger** - one-click PDF export and screenshots. Used exclusively for
  `Page.printToPDF`, `Emulation.setEmulatedMedia` and `Page.captureScreenshot`,
  on tabs the user chose to export or photograph. Attached for the duration of
  that one export and detached immediately after. Never reads network traffic
  or cookies. Not attached at all when the user chooses the print dialog
  instead.
- **downloads** - saves the finished PDF or PNG to the user's Downloads folder.
- **offscreen** - creates the Blob URL for that download, which a service worker
  cannot do itself.

> **Say in the listing that Chrome shows a yellow "is debugging this browser"
> bar while a one-click export runs.** `debugger` is declared rather than requested
> (Deviation 1), so the install prompt arrives before any UI of ours can explain
> it. The popup's hint line carries that sentence for people already installed;
> the listing has to carry it for everyone else.
