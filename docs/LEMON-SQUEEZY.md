# Turning Pro on

A licence key unlocks **Draw mode** - everything else is free (ARCHITECTURE.md
Decision 24). The licence code is written and wired; what is missing is a
product to sell and two constants.

## What already exists

- `lib/license/index.ts` - `activate()`, `validate()`, `deactivate()`,
  `isPro()` against `https://api.lemonsqueezy.com/v1/licenses/*`. Revalidates
  at most weekly and keeps working 30 days past a failed check
  (`tests/license.test.ts`).
- `components/license-form.tsx` - the "I have a key" UI, shared by the popup's
  Pro dialog and the options page. "Lost my key?" points at
  `LICENSE_RECOVERY_URL`.

## In the dashboard

1. Confirm Lemon Squeezy still onboards new stores; if not, see `BACKLOG.md`.
2. Create the store and **one product**: single payment, **$5**.
3. On the variant, turn **license keys on** with an **activation limit of 5**.
4. **Register trader status** in the Chrome Web Store developer dashboard
   before charging anything (project.md §7) - it takes the longest.
5. Copy the buy link: `https://<store>.lemonsqueezy.com/buy/<uuid>`.

## In the code

```ts
// lib/constants.ts
export const LAUNCH_FREE_FOR_ALL = false;
export const CHECKOUT_URL = "https://<store>.lemonsqueezy.com/buy/<uuid>";
```

With `CHECKOUT_URL` empty the Pro dialog says "Not on sale yet". Before turning
`LAUNCH_FREE_FOR_ALL` off, decide what happens to users who installed during
the launch period (see the comment on the constant).

## Testing it

Use **`pnpm build` and load unpacked, not `pnpm dev`** - a dev build is Pro
with no key (`DEV_UNLOCK_PRO`), so it proves nothing.

Buy in **test mode**, paste the key into the popup's Pro dialog, and confirm
Draw unlocks without reopening the popup. The activation should appear in the
dashboard under the extension's `instance_name` (`Hardcopy macOS` etc.).

To age the cache, in the service worker console:

```js
const { license } = await chrome.storage.sync.get("license");
await chrome.storage.sync.set({
  license: { ...license, checkedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 },
});
```

8 days: `isPro()` answers from cache and revalidates in the background. 38 days:
the grace has run out and Pro locks until the next successful check.

## Watch out

- **Every `activate()` uses one of the five slots**; clearing storage does not
  free it. Deactivate test installs from the options page before uninstalling.
- **Take the store out of test mode before submitting** - test-mode keys are
  rejected by the live API.
