/**
 * THIRD_PARTY_LICENSES.txt - the licence notice of every package the build
 * actually ships.
 *
 * MIT, ISC and Apache-2.0 all ask for their notice to travel with copies of the
 * code, and minification drops nearly all of them: lucide's `@license` banner
 * and Tailwind's `/*!` comment are the only two that survive into `.output/`.
 * So the list is taken from the bundles themselves rather than from
 * package.json - a dependency that tree-shakes away entirely is not listed, and
 * a transitive one that ships is.
 *
 * wxt.config.ts does the collecting: a Vite plugin records package roots during
 * each entrypoint's build, and `build:publicAssets`, which WXT runs after the
 * last of those builds, writes the file. This module is the half that does not
 * need a bundle: `packageRoot`, `cssPackageImports` and `renderNotices` are pure
 * and covered by tests/third-party-licenses.test.ts; `findPackage` and
 * `readNotice` read node_modules, and scripts/licenses/ for the few packages
 * that publish no licence file of their own.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Notice {
  name: string;
  version: string;
  /** SPDX expression from package.json, or "UNKNOWN". */
  license: string;
  /** Homepage or repository, when package.json names one. */
  url?: string | undefined;
  /** The package's own licence file, verbatim. Absent when it ships none. */
  text?: string | undefined;
  /** Set when `text` came from the upstream repository, not the package. */
  textFrom?: string | undefined;
}

/**
 * Licence files for packages that publish none, copied from the repository each
 * is built from (scripts/licenses/). MIT wants its copyright line kept, and the
 * package alone cannot supply it.
 *
 * `@radix-ui/react-compose-refs` is here for 1.1.2 only - 1.1.5 ships the same
 * file, byte for byte - and a fallback is only read when a version has none.
 */
export const UPSTREAM_LICENSES: Readonly<Record<string, { file: string; from: string }>> = {
  wxt: { file: "wxt-dev-wxt.txt", from: "https://github.com/wxt-dev/wxt/blob/main/LICENSE" },
  "@wxt-dev/browser": {
    file: "wxt-dev-wxt.txt",
    from: "https://github.com/wxt-dev/wxt/blob/main/LICENSE",
  },
  "@radix-ui/react-compose-refs": {
    file: "radix-ui-primitives.txt",
    from: "https://github.com/radix-ui/primitives/blob/main/LICENSE",
  },
};

const UPSTREAM_DIR = join(dirname(fileURLToPath(import.meta.url)), "licenses");

const NODE_MODULES = "/node_modules/";

/**
 * The directory of the package a bundled module came from, or null for our own
 * code and for Rollup's virtual modules.
 *
 * pnpm nests the real package inside `.pnpm/<name>@<version>/node_modules/`, so
 * it is the *last* `node_modules` segment that names it.
 */
export function packageRoot(id: string): string | null {
  const path = id
    .replace(/^\0/, "")
    .replace(/[?#].*$/, "")
    .replaceAll("\\", "/");
  const at = path.lastIndexOf(NODE_MODULES);
  if (at === -1) return null;

  const [first = "", second = ""] = path.slice(at + NODE_MODULES.length).split("/");
  if (!first || first.startsWith(".")) return null;
  if (first.startsWith("@") && !second) return null;

  const name = first.startsWith("@") ? `${first}/${second}` : first;
  return path.slice(0, at + NODE_MODULES.length) + name;
}

/**
 * The packages a stylesheet `@import`s by bare name - `"tailwindcss"`,
 * `"tw-animate-css"` in assets/tailwind.css.
 *
 * Tailwind compiles those imports itself, so they never enter Rollup's module
 * graph and `packageRoot` never sees them. Relative and absolute paths are our
 * own files, and URLs are not packages; both are skipped.
 */
export function cssPackageImports(css: string): string[] {
  const names = new Set<string>();
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)) {
    const spec = match[1] ?? "";
    if (!spec || /^(\.|\/|[a-z][a-z0-9+.-]*:)/i.test(spec)) continue;
    const parts = spec.split("/");
    names.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? spec));
  }
  return [...names];
}

const RULE = "=".repeat(80);

/**
 * The file itself: one section per package, sorted by name, each with the
 * package's licence text as it publishes it.
 *
 * Deduplicated on name and version, because the same package can be reached
 * through two roots - pnpm's real directory from a bundled module, and the
 * top-level symlink from a CSS import.
 */
export function renderNotices(notices: readonly Notice[]): string {
  const unique = new Map<string, Notice>();
  for (const notice of notices) unique.set(`${notice.name}@${notice.version}`, notice);
  const sorted = [...unique.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );

  const sections = sorted.map((n) => {
    const head = [`${n.name} ${n.version} - ${n.license}`];
    if (n.url) head.push(n.url);
    const from =
      n.text && n.textFrom
        ? `(The package ships no licence file; this is ${n.textFrom}.)\n\n`
        : "";
    const body =
      n.text ?? `This package ships no licence file. Its package.json declares: ${n.license}.`;
    return `${RULE}\n${head.join("\n")}\n\n${from}${body}\n`;
  });

  return [
    "Third-party software notices",
    "",
    "This extension is licensed under FSL-1.1-MIT (see LICENSE.md). It includes",
    "code from the packages below, each under its own licence, reproduced here as",
    "the package publishes it.",
    "",
    `${sorted.length} packages: ${sorted.map((n) => `${n.name}@${n.version}`).join(", ")}`,
    "",
    ...sections,
  ].join("\n");
}

/** Walk up from `fromDir` to the `node_modules/<name>` a bare import resolves to. */
export function findPackage(fromDir: string, name: string): string | null {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;

function licenseId(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "object" && value !== null && "type" in value) {
    const type = (value as { type: unknown }).type;
    if (typeof type === "string") return type;
  }
  return "UNKNOWN";
}

function projectUrl(pkg: Record<string, unknown>): string | undefined {
  if (typeof pkg.homepage === "string" && /^https?:/.test(pkg.homepage)) return pkg.homepage;
  const repo = pkg.repository;
  const raw =
    typeof repo === "string"
      ? repo
      : typeof repo === "object" && repo !== null && "url" in repo
        ? String((repo as { url: unknown }).url)
        : undefined;
  if (!raw) return undefined;
  if (/^github:/.test(raw) || /^[\w.-]+\/[\w.-]+$/.test(raw)) {
    return `https://github.com/${raw.replace(/^github:/, "")}`;
  }
  return raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
}

/** A package's notice, or null when its directory holds no usable package.json. */
export function readNotice(root: string): Notice | null {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof pkg.name !== "string" || typeof pkg.version !== "string") return null;

  const notice: Notice = {
    name: pkg.name,
    version: pkg.version,
    license: licenseId(pkg.license),
    url: projectUrl(pkg),
  };

  const file = readdirSync(root).find((entry) => LICENSE_FILE.test(entry));
  const upstream = UPSTREAM_LICENSES[pkg.name];
  if (file) {
    notice.text = readFileSync(join(root, file), "utf8").trim();
  } else if (upstream) {
    notice.text = readFileSync(join(UPSTREAM_DIR, upstream.file), "utf8").trim();
    notice.textFrom = upstream.from;
  }
  return notice;
}
