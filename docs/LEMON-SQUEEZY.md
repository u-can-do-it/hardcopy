# Turning Pro on (PROJECT.md §6.1)

Everything in the extension is written and tested. This is the half that happens
in a browser tab and a vendor dashboard, and it ends with **one constant
changed**.

What the key unlocks is **Draw mode, all of it** - the tools, the fills
including Cover, the symbols and the text labels. Everything else, one-click
export included, is free (README Deviation 24).

## What already exists - do not rebuild it

`lib/license/index.ts` holds the whole flow: `activate()`, `validate()`,
`deactivate()` and `isPro()`, against
`https://api.lemonsqueezy.com/v1/licenses/*`. It revalidates at most weekly, and
keeps working for 30 days past a failed check so a flaky network can never fail
an export (`tests/license.test.ts` covers the cache and the grace).
`components/license-form.tsx` is the "I have a key" UI, shared by the popup's
Pro dialog and the options page so there is one activation path to get right;
"Lost my key?" already points at `LICENSE_RECOVERY_URL`.

## In the dashboard

1. **Check they are still onboarding new stores.** Stripe acquired Lemon Squeezy
   in 2024 and the roadmap has been quiet since. You find out in five minutes;
   if the answer is no, `BACKLOG.md` has the alternatives.
2. Create the store, then **one product**: single payment, **$5**.
3. On the product's variant, turn **license keys on**, and set the **activation
   limit to 5**. Five is a decision, not a default - §6.3's piracy stance is
   that a $5 key will be shared and that is fine; the limit exists to stop a key
   ending up on a forum, not to police anybody.
4. **Register trader status** in the Chrome Web Store developer dashboard before
   you charge anything (§7). This gates the listing, not the build, but it takes
   longer than everything else here.
5. Copy the product's buy link. It looks like
   `https://<store>.lemonsqueezy.com/buy/<uuid>`.

## In the code

```ts
// lib/constants.ts
export const CHECKOUT_URL = "https://<store>.lemonsqueezy.com/buy/<uuid>";
```

That is the whole change. `PRO_AVAILABLE` is already `true`, and the Pro dialog
shows "Get Pro - $5" the moment `CHECKOUT_URL` is non-empty - it degrades to
"Not on sale yet" without one, which is why the build is shippable today.

## Testing it

**Use `pnpm build` and load unpacked. Not `pnpm dev`.** `DEV_UNLOCK_PRO` follows
the build mode, so a dev build returns `isPro() === true` with no key at all: you
cannot see a locked control, and an activation that "works" there has proved
nothing. This is the trap, and it is the whole reason that constant follows the
build instead of being hand-edited.

Then, on a production build: buy through the checkout in **test mode**, paste the
key into the popup's Pro dialog, and confirm Draw unlocks without reopening the
popup - the button loses its "Pro" badge, and pressing it puts the drawing bar
on the page. Check the activation shows up in the dashboard under the
`instance_name` the extension sends (`pagepdf macOS` and so on).

To exercise the cache without waiting a week, age it by hand in the extension's
service worker console:

```js
const { license } = await chrome.storage.sync.get("license");
await chrome.storage.sync.set({
  license: { ...license, checkedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 },
});
```

Reopen the popup: `isPro()` answers from cache immediately and revalidates in the
background, never blocking. Push `checkedAt` back 38 days instead and the offline
grace has run out, so Pro locks until the next successful check.

## Two things that will bite

- **Every `activate()` burns one of the five slots, and clearing storage does not
  give it back.** Only `deactivate()` frees a slot, and that is the button on the
  options page. Test across three browsers carelessly and you have two left. When
  you are done with a test install, deactivate it rather than uninstalling.
- **Take the store out of test mode before you submit the listing.** A test-mode
  buy link takes real customers to a checkout that issues keys the live API will
  not accept.
