# Startup database

Provisional static pages for a hand-curated list of startups in Hong Kong, Stockholm, Copenhagen and Oslo. It is a database, not a map. Comms owns the intro line. The pages send `noindex` and are not linked from the site nav.

## Refresh

Put the city CSVs in `startups/data/source/` (`hong-kong.csv`, `stockholm.csv`, `copenhagen.csv`, `oslo.csv`). From the repo root:

```bash
node startups/tools/build.mjs
```

The script writes `startups/data/startups.json` and the HTML under `startups/`. Commit the CSVs, the JSON, and the HTML.

A valuation is shown only when `valuation`, `valuation_source` and `valuation_as_of` are all filled. If only some of them are filled, the build stops. The year is always part of the label. Neko Health is shown as `reported ~US$7bn (2026)`, with the source linked. Founding year is not shown. Notes and fact check status are not rendered. Parahelp and Carbon Crusher must not be in the city files.

Operating markets are split on commas. A part that starts with "including" stays on the market before it, so `Global, including San Francisco` is one chip. `global` and `Global` stay as written.

There is no contact email in the site repo yet. The logo footnote leaves the address as TODO (contact).
