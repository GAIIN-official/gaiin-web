# Startup database

Provisional static pages for a hand-curated list of startups in Hong Kong, Stockholm, Copenhagen and Oslo. The index page opens with a world map that filters the list. The list itself is the database. Comms owns the intro line. The pages send `noindex` and are not linked from the site nav.

## Refresh

Put the city CSVs and `scale-ups.csv` in `startups/data/source/`. From the repo root:

```bash
node startups/tools/build.mjs
```

The script writes `startups/data/startups.json` and the HTML under `startups/`. Commit the CSVs, the JSON, and the HTML.

A valuation is shown only when `valuation`, `valuation_source` and `valuation_as_of` are all filled. If only some of them are filled, the build stops. The year is always part of the label. Neko Health is shown as `reported ~US$7bn (2026)`, with the source linked. Founding year is not shown. Notes and fact check status are not rendered. Parahelp and Carbon Crusher must not be in the city files.

Operating markets are trimmed and mapped through `MARKET_CANON` in `startups/tools/build.mjs`. `Global, including San Francisco` becomes Global and US. `global` and `Global` collapse to one Global. Regions and countries stay distinct. Filter pills list regions first, then countries A to Z. Add a new sheet spelling to `MARKET_CANON` or the build stops.

Only `fact_check_status` PASS is rendered. HELD and UNVERIFIED rows are skipped with a warning. A blank logo becomes an initials tile. Names in `DARK_LOGO` use a navy tile. Logo tiles are light otherwise.

The index has a Startups | Scale-ups toggle. Startups is the default. Map counts follow the toggle. City pages list that city's scale-ups in a second section.

## Counts

PASS rows only.

Hong Kong: 16 startups, 11 scale-ups. Stockholm: 13 startups, 11 scale-ups. Copenhagen: 14 startups, 12 scale-ups. Oslo: 10 startups, 12 scale-ups.

`EXCLUDE` drops names that must not render. It currently contains Animoca Brands.

There is no contact email in the site repo yet. The logo footnote leaves the address as TODO (contact).

## World map

`startups/data/world/countries-110m.json` is the 110m country file from [world-atlas](https://github.com/topojson/world-atlas) 2.0.2, converted from Natural Earth Admin 0 country boundaries. Natural Earth is in the public domain. The world-atlas conversion is ISC; the notice is in `startups/data/world/LICENSE`. The build draws that file inline. No map library and no API key.

Markers sit on Hong Kong, Stockholm, Copenhagen, Oslo and San Francisco only. A city marker filters to companies headquartered there. San Francisco filters to companies whose operating markets include the US, and shows Coming soon when that list is empty. The Nordics row under the map selects Oslo, Stockholm and Copenhagen.
