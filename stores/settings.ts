/**
 * Settings as signals, shared by the popup and the options page.
 *
 * Module-scope signals are per-document, and each entrypoint is its own
 * document, so the popup and the options page hold separate copies kept in
 * step through storage.sync rather than through shared memory.
 */

import { computed, signal } from "@preact/signals";

import {
  exportModePatch,
  loadSettings,
  onSettingsChanged,
  pageModePatch,
  patchSettings,
  type SettingsPatch,
} from "@/lib/settings";
import type { ExportMode, ImageFormat, Settings } from "@/lib/types";

/** null until the first read from storage.sync resolves. */
export const settings = signal<Settings | null>(null);

export const settingsReady = computed(() => settings.value !== null);

/**
 * Serialised copy of our own last write, so the storage listener can ignore
 * the echo. Without this, saving while typing in a textarea would clobber the
 * field from under the cursor.
 */
let lastWritten = "";
let unsubscribe: (() => void) | null = null;

export async function initSettingsStore(): Promise<void> {
  unsubscribe ??= onSettingsChanged((next) => {
    if (JSON.stringify(next) === lastWritten) return;
    settings.value = next;
  });
  settings.value = await loadSettings();
}

export function disposeSettingsStore(): void {
  unsubscribe?.();
  unsubscribe = null;
}

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  const next = await patchSettings(patch);
  lastWritten = JSON.stringify(next);
  settings.value = next;
}

/** One click straight to Downloads, or Chrome's print dialog (which ends single page). */
export async function setExportMode(mode: ExportMode): Promise<void> {
  await updateSettings(exportModePatch(mode));
}

/** One continuous sheet instead of A4 pages (which ends the print dialog). */
export async function setSinglePage(single: boolean): Promise<void> {
  await updateSettings(pageModePatch(single ? "single" : "paginated"));
}

/** How screenshots are encoded: WebP, JPEG or lossless PNG. */
export async function setImageFormat(format: ImageFormat): Promise<void> {
  await updateSettings({ imageFormat: format });
}
