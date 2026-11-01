# Startup database

Provisional static pages for a hand-curated list of startups in Hong Kong, Stockholm, Copenhagen and Oslo. The index page opens with a world map that filters the list. The list itself is the database. Comms owns the intro line. The pages send `noindex` and are not linked from the site nav.

## Refresh

Put the city CSVs in `startups/data/source/` (`hong-kong.csv`, `stockholm.csv`, `copenhagen.csv`, `oslo.csv`). From the repo root:

```bash
node startups/tools/build.mjs
```

The script writes `startups/data/startups.json` and the HTML under `startups/`. Commit the CSVs, the JSON, and the HTML.

A valuation is shown only when `valuation`, `valuation_source` and `valuation_as_of` are all filled. If only some of them are filled, the build stops. The year is always part of the label. Neko Health is shown as `reported ~US$7bn (2026)`, with the source linked. Founding year is not shown. Notes and fact check status are not rendered. Parahelp and Carbon Crusher must not be in the city files.

Operating markets are trimmed and mapped through `MARKET_CANON` in `startups/tools/build.mjs`. `Global, including San Francisco` becomes Global and US. `global` and `Global` collapse to one Global. Regions and countries stay distinct. Filter pills list regions first, then countries A to Z. Add a new sheet spelling to `MARKET_CANON` or the build stops.

`LOGO_OVERRIDE` in the same file replaces a sheet logo. A URL is the replacement. An empty string forces the initials tile. Alpha AI is empty until Signal replaces the Housing Society image. Remove the entry once the sheet URL is correct.

There is no contact email in the site repo yet. The logo footnote leaves the address as TODO (contact).

## World map

`startups/data/world/countries-110m.json` is the 110m country file from [world-atlas](https://github.com/topojson/world-atlas) 2.0.2, converted from Natural Earth Admin 0 country boundaries. Natural Earth is in the public domain. The world-atlas conversion is ISC; the notice is in `startups/data/world/LICENSE`. The build draws that file inline. No map library and no API key.

Headquarters markers (Hong Kong, Sweden, Denmark, Norway) are stronger than markers for countries that only show up in operating markets. Sweden, Denmark and Norway stay as small pins on the map, and the Nordics row under the map is where those three are tapped, so the pins do not cover each other. Regions such as Europe, Asia and Global are not countries, so they have no marker. Hong Kong is not a separate shape in this file, so it is a marker only.
