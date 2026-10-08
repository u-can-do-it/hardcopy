/**
 * Filename templating and sanitising (project.md §10.8).
 *
 * Tokens: {title} {host} {date} {time} {datetime}
 * Pure module - no chrome.* - so it is covered by tests/filename.test.ts.
 */

/** Characters Chrome's downloads API and/or Windows reject outright. */
const ILLEGAL = /[/\\:*?"<>|]/g;
/** Windows device names, illegal as a whole filename stem. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export const MAX_FILENAME_LENGTH = 120;
export const PDF_EXT = ".pdf";

export interface FilenameVars {
  title?: string | undefined;
  url?: string | undefined;
  date?: Date | undefined;
}

/**
 * Drop characters that are either illegal in a path or invisible in one:
 * C0/C1 controls, zero-width spaces, bidi overrides, word joiner and BOM.
 * A page title lifted from `<title>` regularly contains these.
 */
function stripUnprintable(input: string): string {
  let out = "";
  for (const ch of input) {
    const c = ch.codePointAt(0) as number;

    // Tab/newline/CR and friends become a space rather than vanishing: a title
    // wrapped across two lines should read "tab and newline", not
    // "tabandnewline". The \s+ collapse below tidies up the result.
    if (c === 0x09 || (c >= 0x0a && c <= 0x0d)) {
      out += " ";
      continue;
    }

    const isControl = c < 0x20 || (c >= 0x7f && c <= 0x9f);
    const isZeroWidth = c >= 0x200b && c <= 0x200f; // U+200B..U+200F
    const isBidiOverride = c >= 0x202a && c <= 0x202e; // U+202A..U+202E
    const isJoinerOrBom = c === 0x2060 || c === 0xfeff;
    if (isControl || isZeroWidth || isBidiOverride || isJoinerOrBom) continue;
    out += ch;
  }
  return out;
}

/** `2026-09-07` in local time - the user's day is the one they mean, not UTC's. */
export function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `14-30-05`, colon-free so it survives every filesystem. */
export function formatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Hostname without `www.`, or "" when the URL is unparseable. */
export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Strip everything a filesystem would object to, without collapsing the name
 * into emptiness. Does not add or expect an extension.
 */
export function sanitiseSegment(input: string): string {
  const cleaned = stripUnprintable(input)
    .replace(ILLEGAL, "-")
    .replace(/\s+/g, " ")
    .trim();

  // Collapse separator runs left behind by the replacements above, then trim
  // leading/trailing separators and dots (Windows rejects trailing dots).
  const trimmed = cleaned
    .replace(/-{2,}/g, "-")
    .replace(/^[-.\s]+/, "")
    .replace(/[-.\s]+$/, "");

  return RESERVED.test(trimmed) ? `${trimmed}-page` : trimmed;
}

/**
 * Render a template to a filename with `extension` on the end.
 *
 * Falls back, in order: the template's own output -> the hostname -> "page".
 * The result is always non-empty and never longer than MAX_FILENAME_LENGTH,
 * extension included. Screenshots reuse the same template as exports - the
 * user named their files once.
 */
export function renderFilename(
  template: string,
  vars: FilenameVars,
  extension: string = PDF_EXT,
): string {
  const date = vars.date ?? new Date();
  const host = hostOf(vars.url);

  const tokens: Record<string, string> = {
    title: vars.title?.trim() ?? "",
    host,
    date: formatDate(date),
    time: formatTime(date),
    datetime: `${formatDate(date)}-${formatTime(date)}`,
  };

  const replaced = template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in tokens ? (tokens[name] as string) : whole,
  );

  // An empty {title} leaves dangling separators behind ("-2026-09-07"), which
  // sanitiseSegment trims; only then can we tell the name is really empty.
  let stem = sanitiseSegment(replaced);
  if (!stem) stem = sanitiseSegment(host);
  if (!stem) stem = "page";

  const room = MAX_FILENAME_LENGTH - extension.length;
  if (stem.length > room) {
    stem = sanitiseSegment(stem.slice(0, room)) || "page";
  }

  return stem + extension;
}
