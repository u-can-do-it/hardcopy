/**
 * Lemon Squeezy license keys - no accounts, no login (PROJECT.md §6.1).
 *
 * Two rules this module exists to enforce:
 *   - Gate features, never counters. `isPro()` is the only switch in the
 *     codebase and there is no export counter anywhere.
 *   - Never call home on the export path. `isPro()` answers from cache and
 *     revalidates in the background, so a flaky network can never fail a save.
 */

import { DEV_UNLOCK_PRO, LAUNCH_FREE_FOR_ALL, PRO_AVAILABLE } from "../constants";

const API = "https://api.lemonsqueezy.com/v1/licenses";
const STORAGE_KEY = "license";
const REQUEST_TIMEOUT_MS = 10_000;

/** Revalidate at most weekly. */
export const REVALIDATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Keep working this long past a failed revalidation (§6.1). */
export const OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export interface LicenseCache {
  key: string;
  instanceId: string;
  paid: boolean;
  /** Epoch ms of the last successful activate/validate. */
  checkedAt: number;
}

export interface CacheVerdict {
  pro: boolean;
  /** Stale enough to re-check, in the background, never blocking. */
  shouldRevalidate: boolean;
  /** Offline grace ran out; the user has to reconnect once. */
  graceExpired: boolean;
}

/** Pure - covered by tests/license.test.ts. */
export function evaluateCache(cache: LicenseCache | null, now: number): CacheVerdict {
  if (!cache || !cache.paid) {
    return { pro: false, shouldRevalidate: false, graceExpired: false };
  }
  const age = now - cache.checkedAt;
  const shouldRevalidate = age > REVALIDATE_AFTER_MS;
  const graceExpired = age > REVALIDATE_AFTER_MS + OFFLINE_GRACE_MS;
  return { pro: !graceExpired, shouldRevalidate, graceExpired };
}

async function readCache(): Promise<LicenseCache | null> {
  try {
    const got = await chrome.storage.sync.get(STORAGE_KEY);
    const raw = got[STORAGE_KEY] as unknown;
    if (typeof raw !== "object" || raw === null) return null;
    const c = raw as Record<string, unknown>;
    if (typeof c.key !== "string" || typeof c.checkedAt !== "number") return null;
    return {
      key: c.key,
      instanceId: typeof c.instanceId === "string" ? c.instanceId : "",
      paid: c.paid === true,
      checkedAt: c.checkedAt,
    };
  } catch {
    return null;
  }
}

async function writeCache(cache: LicenseCache | null): Promise<void> {
  // Licence state lives in `sync` only, so it follows the profile and survives
  // reinstalls - the opposite of a local counter (§6.1).
  if (cache === null) await chrome.storage.sync.remove(STORAGE_KEY);
  else await chrome.storage.sync.set({ [STORAGE_KEY]: cache });
}

async function post(path: string, body: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body).toString(),
      signal: controller.signal,
    });
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

/** `instance_name` shows up in the vendor dashboard; keep it human. */
function instanceName(): string {
  const ua = navigator.userAgent;
  const os = /Mac/.test(ua) ? "macOS" : /Win/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return `pagepdf ${os}`.trim();
}

export type ActivateResult = { ok: true } | { ok: false; error: string };

export async function activate(key: string): Promise<ActivateResult> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: "Paste your license key first." };

  let payload: unknown;
  try {
    payload = await post("activate", { license_key: trimmed, instance_name: instanceName() });
  } catch {
    return { ok: false, error: "Could not reach the license server. Check your connection." };
  }

  const p = (payload ?? {}) as Record<string, unknown>;
  if (p.activated !== true) {
    const error = typeof p.error === "string" ? p.error : "That key was not accepted.";
    return { ok: false, error };
  }

  const instance = (p.instance ?? {}) as Record<string, unknown>;
  await writeCache({
    key: trimmed,
    instanceId: typeof instance.id === "string" ? instance.id : "",
    paid: true,
    checkedAt: Date.now(),
  });
  return { ok: true };
}

/** Re-check a stored key. Returns false only on a definitive rejection. */
export async function validate(): Promise<boolean> {
  const cache = await readCache();
  if (!cache) return false;

  let payload: unknown;
  try {
    payload = await post("validate", {
      license_key: cache.key,
      ...(cache.instanceId ? { instance_id: cache.instanceId } : {}),
    });
  } catch {
    // Network failure is not a revocation - the offline grace covers it.
    return cache.paid;
  }

  const p = (payload ?? {}) as Record<string, unknown>;
  if (p.valid === true) {
    await writeCache({ ...cache, paid: true, checkedAt: Date.now() });
    return true;
  }
  await writeCache({ ...cache, paid: false, checkedAt: Date.now() });
  return false;
}

/** Frees an activation slot (options page). */
export async function deactivate(): Promise<void> {
  const cache = await readCache();
  if (cache?.instanceId) {
    try {
      await post("deactivate", { license_key: cache.key, instance_id: cache.instanceId });
    } catch {
      // Local state is cleared regardless; the slot frees on the next validate.
    }
  }
  await writeCache(null);
}

/**
 * The single Pro switch. Never awaits the network.
 */
export async function isPro(): Promise<boolean> {
  if (!PRO_AVAILABLE) return false;

  // The launch period: Pro for everyone, quietly - it is the shipping state,
  // not a developer override, so no warning (lib/constants.ts).
  if (LAUNCH_FREE_FOR_ALL) return true;

  if (DEV_UNLOCK_PRO) {
    console.warn("[pagepdf] DEV_UNLOCK_PRO is on - Pro is unlocked without a key.");
    return true;
  }

  const cache = await readCache();
  const verdict = evaluateCache(cache, Date.now());
  if (verdict.shouldRevalidate) {
    void validate().catch(() => undefined);
  }
  return verdict.pro;
}

export async function licenseStatus(): Promise<{
  hasKey: boolean;
  pro: boolean;
  graceExpired: boolean;
}> {
  const cache = await readCache();
  const verdict = evaluateCache(cache, Date.now());
  return { hasKey: cache !== null, pro: verdict.pro, graceExpired: verdict.graceExpired };
}
