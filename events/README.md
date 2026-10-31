# Events

The `/events` page lists upcoming AI and innovation events in GAIIN's founding hubs. It is a curated discovery feed from public Luma pages. Registration happens on Luma.

The browser does not call Luma. It reads the committed snapshot at `events/data/events.json`. Events that have already started are hidden, and a city with nothing left to show is left off the page.

## Refresh

From the repo root:

```bash
node events/tools/fetch-luma.mjs
```

Review the diff, then commit `events/data/events.json`.

The script keeps future events whose name, calendar, or hosts match AI, tech, climate, startup, founder, innovation, and nearby terms. It drops clear nightlife, sports, and unrelated social events. Each event stores `cover_url` from Luma's `event.cover_url`. The page hotlinks a small thumbnail of that file from Luma's image CDN.

## Add a city

Edit `CITIES` in `events/tools/fetch-luma.mjs`. One city is one line:

```js
{ slug: "singapore", city: "Singapore", hub: "APAC" },
```

`slug` is the Luma place slug. `hub` is `APAC` or `Europe`. Run the script and commit the snapshot. The page groups whatever cities are in the file.

v1 is Hong Kong, Stockholm, Copenhagen, and Oslo. Later one-line additions, not included yet: Singapore (`singapore`, APAC), London (`london`, Europe), Berlin (`berlin`, Europe).
