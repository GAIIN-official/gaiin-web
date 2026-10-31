# Events

The `/events` page lists upcoming AI and innovation events in GAIIN's founding hubs. It is a curated discovery feed from public Luma pages. Registration happens on Luma.

The browser does not call Luma. It reads the committed snapshot at `events/data/events.json`. A card stays up until its end time. If Luma has no end time, it stays up until three hours after the start. A city with nothing left to show is left off the page.

## Refresh

From the repo root:

```bash
node events/tools/fetch-luma.mjs
```

Review the diff, then commit `events/data/events.json`.

The script keeps events whose name, calendar, or hosts match AI, tech, climate, startup, founder, innovation, and nearby terms. It drops clear nightlife, sports, and unrelated social events. It also drops an event whose end is already past, or whose start is already past when Luma has no end time. Each event stores `cover_url` from Luma's `event.cover_url`. The page hotlinks a small thumbnail of that file from Luma's image CDN.

If the filtered list is empty, the script exits with an error and does not replace `events/data/events.json`.

## Automatic refresh

`.github/workflows/events-refresh.yml` runs on Monday, Wednesday, and Friday at 06:00 HKT. That is 22:00 UTC the evening before (`0 22 * * 0,2,4`). It checks out `main`, runs the script, and, when the snapshot changed, commits as `github-actions[bot]` with the message `chore(events): refresh Luma snapshot`, then pushes to `main`. That push is what publishes the page through the normal Vercel production deploy.

A run that finds the same events does not commit. If Luma fails, or the filtered list is empty, the job fails and the current snapshot stays in place.

Run it by hand from the Actions tab: open **Refresh events**, then **Run workflow**. From the CLI, on this repo:

```bash
gh workflow run "Refresh events" --ref main
```

## Add a city

Edit `CITIES` in `events/tools/fetch-luma.mjs`. One city is one line:

```js
{ slug: "singapore", city: "Singapore", hub: "APAC" },
```

`slug` is the Luma place slug. `hub` is `APAC`, `Europe`, or `Global`. Run the script and commit the snapshot. The page groups whatever cities are in the file. Each city keeps the next 12 upcoming matches.

The list is Hong Kong, Singapore (`singapore`), and Tokyo (`tokyo`) in APAC; Stockholm, Copenhagen, Oslo, London (`london`), and Berlin (`berlin`) in Europe; San Francisco (`sf`) in Global. Founding cities stay first in their region.

`.github/workflows/events-refresh.yml` runs this script and does not name cities, so the next refresh includes whatever is in `CITIES`.
