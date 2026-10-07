/**
 * Settings live in chrome.storage.sync under one key, so they follow the
 * user's profile across devices (PROJECT.md §2).
 *
 * `mergeSettings` is pure and validating: anything stored by an older version,
 * or corrupted, degrades to the default for that one field instead of throwing
 * and leaving the popup blank.
 */

import type { ExportMode, ImageFormat, PageMode, PrepOptions, Settings } from "./types";

const KEY = "settings";

export const DEFAULT_SETTINGS: Settings = {
  prep: {
    hideSticky: true,
    stickyMinHeight: 40,
    hideSelectors: [],
    expandDetails: true,
    unlockScrollContainers: true,
    loadLazyImages: true,
    addHeader: false,
    exactColors: true,
  },
  filenameTemplate: "{title}-{date}",
  exportMode: "screen",
  pageMode: "paginated",
  imageFormat: "webp",
};

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function strList(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return out.map((s) => s.trim());
}

function exportMode(v: unknown): ExportMode {
  return v === "print" ? "print" : "screen";
}

function pageMode(v: unknown): PageMode {
  return v === "single" ? "single" : "paginated";
}

function imageFormat(v: unknown): ImageFormat {
  return v === "png" || v === "jpeg" || v === "webp" ? v : DEFAULT_SETTINGS.imageFormat;
}

/**
 * The page mode an export may actually use.
 *
 * `settings.pageMode` records what the user asked for, and the print dialog
 * cannot give them `single`: Chrome takes the paper size from its own dropdown
 * and discards `@page { size }`. So a `print` export falls back to `paginated`
 * rather than failing - the user asked for a PDF, and paginated is the honest
 * thing to hand them - and asking for single-page CSS there would only unsettle
 * the layout of a document that is going to be paginated regardless.
 */
export function effectivePageMode(
  stored: PageMode,
  mode: ExportMode,
  override?: PageMode | undefined,
): PageMode {
  if (mode === "print") return "paginated";
  return pageMode(override ?? stored);
}

/** Validate and fill in an arbitrary stored blob. Never throws. */
export function mergeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (typeof raw !== "object" || raw === null) return structuredCloneOf(d);

  const r = raw as Record<string, unknown>;
  const rp = (typeof r.prep === "object" && r.prep !== null ? r.prep : {}) as Record<
    string,
    unknown
  >;

  const prep: PrepOptions = {
    hideSticky: bool(rp.hideSticky, d.prep.hideSticky),
    stickyMinHeight: num(rp.stickyMinHeight, d.prep.stickyMinHeight, 0, 2000),
    hideSelectors: strList(rp.hideSelectors, d.prep.hideSelectors),
    expandDetails: bool(rp.expandDetails, d.prep.expandDetails),
    unlockScrollContainers: bool(rp.unlockScrollContainers, d.prep.unlockScrollContainers),
    loadLazyImages: bool(rp.loadLazyImages, d.prep.loadLazyImages),
    addHeader: bool(rp.addHeader, d.prep.addHeader),
    exactColors: bool(rp.exactColors, d.prep.exactColors),
  };

  return {
    prep,
    filenameTemplate: str(r.filenameTemplate, d.filenameTemplate).trim() || d.filenameTemplate,
    exportMode: exportMode(r.exportMode),
    pageMode: pageMode(r.pageMode),
    imageFormat: imageFormat(r.imageFormat),
  };
}

function structuredCloneOf(s: Settings): Settings {
  return { ...s, prep: { ...s.prep, hideSelectors: [...s.prep.hideSelectors] } };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const got = await chrome.storage.sync.get(KEY);
    return mergeSettings(got[KEY]);
  } catch {
    // Sync can be unavailable (policy, signed-out profile). Defaults still work.
    return structuredCloneOf(DEFAULT_SETTINGS);
  }
}

export interface SettingsPatch {
  prep?: Partial<PrepOptions>;
  filenameTemplate?: string;
  exportMode?: ExportMode;
  pageMode?: PageMode;
  imageFormat?: ImageFormat;
}

/** Read-modify-write one field group. Returns the settings as they now stand. */
export async function patchSettings(patch: SettingsPatch): Promise<Settings> {
  const current = await loadSettings();
  const next = mergeSettings({
    ...current,
    ...patch,
    prep: { ...current.prep, ...(patch.prep ?? {}) },
  });
  await chrome.storage.sync.set({ [KEY]: next });
  return next;
}

export async function resetSettings(): Promise<Settings> {
  await chrome.storage.sync.set({ [KEY]: DEFAULT_SETTINGS });
  return structuredCloneOf(DEFAULT_SETTINGS);
}

/**
 * Live updates, so an open options page and popup never disagree.
 *
 * Degrades to a no-op if the storage API is unreachable, matching
 * `loadSettings`. Losing live sync is a small thing; a throw here happens
 * before the first read resolves and would leave the UI inert, with every
 * control disabled and nothing explaining why.
 */
export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== "sync" || !(KEY in changes)) return;
    cb(mergeSettings(changes[KEY]?.newValue));
  };

  try {
    chrome.storage.onChanged.addListener(listener);
  } catch {
    return () => {};
  }

  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch {
      /* already gone */
    }
  };
}
