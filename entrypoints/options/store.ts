/**
 * Options page state as signals.
 *
 * The drafts and the debounced save live in stores/drafts.ts; what is left here
 * is first load, and "Reset to defaults".
 */

import { resetSettings } from "@/lib/settings";
import { flashSaved, syncDraftsFromSettings } from "@/stores/drafts";
import { refreshLicense } from "@/stores/license";
import { initSettingsStore, settings } from "@/stores/settings";

export async function initOptions(): Promise<void> {
  await initSettingsStore();
  syncDraftsFromSettings();
  // Reads the key's state into `licenseState`, which the licence form shows,
  // and `isPro()` into `proUnlocked`.
  await refreshLicense();
}

export async function resetAll(): Promise<void> {
  settings.value = await resetSettings();
  syncDraftsFromSettings();
  flashSaved();
}
