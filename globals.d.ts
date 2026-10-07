/**
 * Ambient types for the whole project.
 *
 * The `chrome` namespace is referenced explicitly rather than left to
 * TypeScript's automatic `node_modules/@types` inclusion. That automatic path
 * works, but it is silently lost whenever the compiler falls back to a default
 * project - most easily when `tsconfig.json`'s `extends` target,
 * `.wxt/tsconfig.json`, has not been generated yet (it is gitignored, and
 * `wxt prepare` writes it). The visible symptom is a fresh clone, or an editor
 * whose TS server started before the first install, reporting
 * "Cannot find name 'chrome'" in every file that uses an extension API.
 *
 * Run `pnpm compile` (or `pnpm install`) to regenerate `.wxt`, and restart the
 * editor's TS server if it was open at the time.
 */

/// <reference types="chrome" />
