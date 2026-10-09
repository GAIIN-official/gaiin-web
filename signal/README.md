# Signal masthead

Weekly hero images are rendered from HTML so the webfonts and hex values stay locked. The artboard is **1200×480**.

Open `signal/masthead.html`. The page is the artboard. Nothing outside that rectangle is part of the hero.

## Fill

Three fields only, in the `#masthead-fill` JSON block:

| Field | Type | Role |
| --- | --- | --- |
| `issueDate` | `DD MMM YYYY` | Fragment Mono, under the wordmark |
| `headline` | one string | Playfair Display, `#dce7f2` |
| `hook` | one line | Libre Franklin, `--signal-accent` (`#C9A79E`) |

The same three names can be passed as query parameters. They override the JSON for that load. Do not add a fourth fill field.

Accent is the CSS variable `--signal-accent` in `signal/masthead.html`. The default is dusty rose `#C9A79E`. Site coral `#d9877c` is not used on this artboard.

The logo is the official primary lockup (light clay `#EDB3A8` letters, white `#FFFFFF` name line; brand kit v1.0.2) at `signal/assets/gaiin-lockup-clay-white-wide.svg`. Do not redraw, retype or recolour it. The hero does not contain the word Signal. The footer line is `gaiin.xyz`.

## Export a PNG

The capture must be exactly 1200×480 at device pixel ratio 1.

**Browser.** Open `signal/masthead.html`, set the viewport to 1200×480, and screenshot the viewport (or the `#masthead` element). A full-window grab of a larger browser will include empty space outside the artboard.

**Script.** From the repo root, with Chrome installed (`CHROME_PATH` if it is not `google-chrome` on your PATH):

```bash
node signal/tools/export-masthead.mjs --out signal/2026-10-06-hero.png
```

Optional flags: `--issueDate`, `--headline`, `--hook`.

Playwright or Puppeteer works the same way: viewport `{ width: 1200, height: 480 }`, `deviceScaleFactor: 1`, wait for `document.fonts.ready`, then screenshot `#masthead`.

```js
await page.setViewportSize({ width: 1200, height: 480 });
await page.goto("signal/masthead.html");
await page.evaluate(() => document.fonts.ready);
await page.locator("#masthead").screenshot({ path: "signal/2026-10-06-hero.png" });
```

`signal/2026-10-06-hero.png` is the sample export of the default fill:

- issueDate: `06 OCT 2026`
- headline: `Hong Kong leads workplace AI — training still lags`
- hook: `Five reads on AI and innovation from across the network.`
