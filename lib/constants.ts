/** Build-time feature flags and fixed strings. */

/**
 * Whether the Pro features exist in this build. When false the Draw button
 * still shows, but tapping it explains Pro instead of starting annotate mode.
 */
export const PRO_AVAILABLE = true;

/**
 * Launch period: every browser is Pro, with no key and nothing for sale.
 *
 * On while the extension finds its first users. `isPro()` answers true for
 * everyone, so Draw mode is free, and the popup's "Pro?" link and the options
 * page's licence card are hidden - there is no shop to point at. A hand-edited
 * boolean on purpose, unlike `DEV_UNLOCK_PRO`: this one *is* meant to ship.
 *
 * Turning it off is the whole of re-enabling Pro; the licence code underneath
 * never stops working. Decide first what happens to people who installed while
 * it was on: a later version sees them in `chrome.runtime.onInstalled` as
 * `reason: "update"` with a `previousVersion` from this period, and that is the
 * moment to keep Draw free for them if the answer is yes.
 */
export const LAUNCH_FREE_FOR_ALL = true;

/**
 * Treat this browser as licensed without a key.
 *
 * There is no product to buy a key from yet, so this is the only way to
 * exercise Draw mode. It follows the build rather than a hand-edited
 * boolean: `pnpm dev` runs WXT in `development` mode and unlocks Pro, `pnpm
 * build` runs it in `production` and does not - so there is no line left to
 * remember to flip before publishing, which is what the old constant was.
 *
 * The comparison is against `"development"` and not `import.meta.env.DEV`
 * deliberately: vitest also sets `DEV`, and a unit suite that quietly runs as
 * Pro is the kind of green that means nothing. Under vitest `MODE` is
 * `"test"`, so this is false there too.
 *
 * `isPro()` warns on every call while it is on.
 */
export const DEV_UNLOCK_PRO = import.meta.env.MODE === "development";

/** Lemon Squeezy checkout, filled in when the product exists (project.md §6.1). */
export const CHECKOUT_URL = "";

/** Lemon Squeezy license recovery ("Lost my key?"). */
export const LICENSE_RECOVERY_URL = "https://app.lemonsqueezy.com/my-orders";

/** Required by the store before charging; fill in before submitting v0.2. */
export const PRIVACY_POLICY_URL = "";
