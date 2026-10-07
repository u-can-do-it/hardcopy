/**
 * Text-field drafts and debounced saving for the options page.
 *
 * Text fields keep a local draft signal rather than reading straight from the
 * settings signal: saving is debounced, and a field bound directly to storage
 * would rewrite itself under the cursor mid-word.
 */

import { computed, signal } from "@preact/signals";

import { renderFilename } from "@/lib/filename";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { settings, updateSettings } from "@/stores/settings";

const SAVE_DEBOUNCE_MS = 350;
const SAVED_FLASH_MS = 1600;

export const hideSelectorsDraft = signal("");
export const filenameDraft = signal("");
export const stickyMinHeightDraft = signal("");
export const savedFlash = signal(false);

/**
 * What the filename preview renders against: a made-up page, because the
 * options page has no page to speak of - it *is* the tab, and previewing
 * "pagepdf settings" would be a worse example than the sample.
 */
export const SAMPLE_PAGE = {
  title: "How Chrome prints a web page",
  url: "https://example.com/blog/printing",
};

/** Live example, so the token list is never guesswork. */
export const filenamePreview = computed(() =>
  renderFilename(filenameDraft.value, SAMPLE_PAGE),
);

/**
 * Load the drafts from settings. Called once after the first read resolves, and
 * again after a reset - never on every storage change, which would be the
 * cursor-clobbering the drafts exist to avoid.
 */
export function syncDraftsFromSettings(): void {
  const current = settings.value;
  if (!current) return;
  hideSelectorsDraft.value = current.prep.hideSelectors.join("\n");
  filenameDraft.value = current.filenameTemplate;
  stickyMinHeightDraft.value = String(current.prep.stickyMinHeight);
}

let flashTimer: number | undefined;

export function flashSaved(): void {
  savedFlash.value = true;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    savedFlash.value = false;
  }, SAVED_FLASH_MS);
}

/** Push the current drafts into storage. */
async function saveDrafts(): Promise<void> {
  const parsed = Number.parseInt(stickyMinHeightDraft.value, 10);

  await updateSettings({
    prep: {
      hideSelectors: hideSelectorsDraft.value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      stickyMinHeight: Number.isFinite(parsed) ? parsed : DEFAULT_SETTINGS.prep.stickyMinHeight,
    },
    filenameTemplate: filenameDraft.value,
  });
  flashSaved();
}

let saveTimer: number | undefined;

export function saveDraftsSoon(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveDrafts(), SAVE_DEBOUNCE_MS);
}

/** For fields where "done editing" is a discrete event (number input, blur). */
export function saveDraftsNow(): void {
  window.clearTimeout(saveTimer);
  void saveDrafts();
}

/**
 * Save a switch immediately - there is nothing to debounce - and flash "Saved"
 * the way the text fields do.
 */
export async function saveToggle(patch: Parameters<typeof updateSettings>[0]): Promise<void> {
  await updateSettings(patch);
  flashSaved();
}
