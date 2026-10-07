/**
 * Licence state as signals (PROJECT.md §6.1).
 *
 * Note the split between two questions that are easy to conflate:
 *   - `licenseState.pro` - does the user hold a valid key?
 *   - `PRO_AVAILABLE`    - is Pro switched on in this build at all?
 * A key can be active while Pro is switched off, so the UI gates on both and
 * never unlocks a control that would not work.
 *
 * `proUnlocked` answers the only question a gated control should ask, and it
 * answers it with `isPro()` - the one switch - rather than by re-deriving
 * entitlement from the key state here.
 */

import { signal } from "@preact/signals";

import { activate, deactivate, isPro, licenseStatus } from "@/lib/license";

export interface LicenseState {
  hasKey: boolean;
  pro: boolean;
  graceExpired: boolean;
}

export const licenseState = signal<LicenseState | null>(null);
export const licenseBusy = signal(false);
export const licenseError = signal<string | null>(null);
export const licenseNotice = signal<string | null>(null);

/**
 * `isPro()`, the switch every gated feature reads (lib/license).
 *
 * `null` until the first read resolves; a locked control stays locked while it
 * is unknown, so nothing is briefly offered and then taken back. Refreshed by
 * every activate/deactivate, so paying for a key unlocks the Draw button the
 * user tapped to get here without reopening the popup.
 */
export const proUnlocked = signal<boolean | null>(null);

export async function refreshLicense(): Promise<void> {
  const [state, pro] = await Promise.all([licenseStatus(), isPro()]);
  licenseState.value = state;
  proUnlocked.value = pro;
}

export async function activateKey(key: string): Promise<boolean> {
  licenseBusy.value = true;
  licenseError.value = null;
  licenseNotice.value = null;

  try {
    const result = await activate(key);
    if (!result.ok) {
      licenseError.value = result.error;
      return false;
    }
    await refreshLicense();
    licenseNotice.value = "Key activated. Thank you.";
    return true;
  } finally {
    licenseBusy.value = false;
  }
}

export async function deactivateKey(): Promise<void> {
  licenseBusy.value = true;
  licenseError.value = null;
  licenseNotice.value = null;

  try {
    await deactivate();
    await refreshLicense();
    licenseNotice.value = "Key removed from this browser.";
  } finally {
    licenseBusy.value = false;
  }
}
