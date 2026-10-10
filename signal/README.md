# Signal masthead

Weekly hero images are rendered from HTML so the webfonts and hex values stay locked. The artboard is **1200×480**.

Open `signal/masthead.html`. The page is the artboard. Nothing outside that rectangle is part of the hero.

## Fill

Fields in the `#masthead-fill` JSON block:

| Field | Type | Role |
| --- | --- | --- |
| `issueDate` | `DD MMM YYYY` | Fragment Mono, under the wordmark |
| `headline` | one string | Playfair Display, `#dce7f2` |
| `hook` | one line | Libre Franklin, `--signal-accent` (`#C9A79E`) |
| `photo` | URL or repo-root path | Background photo under the navy overlay. Empty keeps solid navy. |
| `photoPosition` | CSS `object-position`, optional | Focal point, e.g. `center 40%`. Defaults to `center`. |

The same names can be passed as query parameters. They override the JSON for that load. `issueDate`, `headline`, `hook`, and `photoPosition` override only when the parameter is non-empty. A present `photo` parameter always wins, including `?photo=` which clears the photo.

Accent is the CSS variable `--signal-accent` in `signal/masthead.html`. The default is dusty rose `#C9A79E`. Site coral `#d9877c` is not used on this artboard.

The logo is the official primary lockup (light clay `#EDB3A8` letters, white `#FFFFFF` name line; brand kit v1.0.2) at `signal/assets/gaiin-lockup-clay-white-wide.svg`. Do not redraw, retype or recolour it. The hero does not contain the word Signal. The footer line is `gaiin.xyz`.

## Photo

Layer order, bottom to top: the photo (`object-fit: cover`, centered unless `photoPosition` is set), then the homepage hero overlay `linear-gradient(rgba(13,41,81,.82),rgba(10,23,48,.93))`, then the existing pattern, then the type and the clay lockup.

`photo` is a URL (Cloudinary preferred) or a path from the repo root, such as `signal/photos/week.jpg`. With an empty `photo`, the artboard is solid navy `#0a1730` plus the pattern — the same field as before this slot existed.

Use a landscape frame at least 2000px wide, and keep the subject away from the left text column. Prefer GAIIN's own event photos. Cloudinary URLs can use transformations like `w_2400,q_auto,f_auto`.

## Export a PNG

The capture must be exactly 1200×480 at device pixel ratio 1.

**Browser.** Open `signal/masthead.html`, set the viewport to 1200×480, and screenshot the viewport (or the `#masthead` element). A full-window grab of a larger browser will include empty space outside the artboard.

**Script.** From the repo root, with Chrome installed (`CHROME_PATH` if it is not `google-chrome` on your PATH):

```bash
node signal/tools/export-masthead.mjs --out signal/2026-10-06-hero.png
```

Optional flags: `--issueDate`, `--headline`, `--hook`, `--photo`, `--photoPosition`. `--json file.json` reads those same fields for one issue; a flag overrides the matching key from that file. `--photo ""` exports the solid navy field. The script waits for `document.fonts.ready` and, when a photo is set, for that image to load and decode before it captures.

Playwright or Puppeteer works the same way: viewport `{ width: 1200, height: 480 }`, `deviceScaleFactor: 1`, wait for `document.fonts.ready` and for `.photo` to finish loading when it has a `src`, then screenshot `#masthead`.

```js
await page.setViewportSize({ width: 1200, height: 480 });
await page.goto("signal/masthead.html");
await page.evaluate(() => document.fonts.ready);
await page.locator(".photo").evaluate(async (img) => {
  if (!img.closest("#masthead").classList.contains("has-photo")) return;
  if (!(img.complete && img.naturalWidth > 0)) {
    await new Promise((resolve, reject) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", () => reject(new Error("photo failed to load")), { once: true });
    });
  }
  if (img.decode) await img.decode();
});
await page.locator("#masthead").screenshot({ path: "signal/2026-10-06-hero.png" });
```

`signal/2026-10-06-hero.png` is the sample export of the default fill:

- issueDate: `06 OCT 2026`
- headline: `Hong Kong leads workplace AI — training still lags`
- hook: `Five reads on AI and innovation from across the network.`
- photo: `https://res.cloudinary.com/x3vpljyu/image/upload/v1789291449/Pitch-hack.webp`
