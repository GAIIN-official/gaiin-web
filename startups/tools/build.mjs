#!/usr/bin/env node
/**
 * Turn the Signal Sheet CSVs into startups/data/startups.json and the HTML pages.
 *
 * Usage, from the repo root:
 *   node startups/tools/build.mjs
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDir = path.join(root, "startups/data/source");

const CITIES = [
  { slug: "hong-kong", label: "Hong Kong", file: "hong-kong.csv" },
  { slug: "stockholm", label: "Stockholm", file: "stockholm.csv" },
  { slug: "copenhagen", label: "Copenhagen", file: "copenhagen.csv" },
  { slug: "oslo", label: "Oslo", file: "oslo.csv" },
];

const BANNED = ["parahelp", "carbon crusher"];
const SECTOR_ORDER = [
  "AI",
  "Deep tech",
  "Climate / energy",
  "Fintech",
  "Robotics / physical AI",
  "Blockchain",
  "Health",
  "New business models",
  "Other",
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Names whose logos are light marks, so the tile is navy with a hairline border.
const DARK_LOGO = ["Libpet", "DBinsight.ai", "Visoid", "Flocean", "Pantheon Lab", "No Isolation", "Pixotope"];

const REGION_ORDER = ["Global", "Asia", "East Asia", "Southeast Asia", "Greater China", "Europe", "Nordics", "North America"];

// Trimmed sheet values map to one or more canonical names. Regions stay distinct from countries.
const MARKET_CANON = {
  global: ["Global"],
  Global: ["Global"],
  "Global, including San Francisco": ["Global", "US"],
  Asia: ["Asia"],
  "East Asia": ["East Asia"],
  "Southeast Asia": ["Southeast Asia"],
  "Greater China": ["Greater China"],
  Europe: ["Europe"],
  Nordics: ["Nordics"],
  "North America": ["North America"],
  Singapore: ["Singapore"],
  Denmark: ["Denmark"],
  Germany: ["Germany"],
  "Hong Kong": ["Hong Kong"],
  Netherlands: ["Netherlands"],
  Norway: ["Norway"],
  Sweden: ["Sweden"],
  Taiwan: ["Taiwan"],
  UAE: ["UAE"],
  UK: ["UK"],
  US: ["US"],
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift();
  return rows
    .filter((cells) => cells.some((value) => value.trim()))
    .map((cells) => {
      const record = {};
      header.forEach((key, index) => {
        record[key] = cells[index] == null ? "" : cells[index];
      });
      return record;
    });
}

function marketsOf(value) {
  const parts = splitList(value, ",");
  const markets = [];
  for (const part of parts) {
    if (/^including\b/i.test(part) && markets.length) {
      markets[markets.length - 1] = `${markets[markets.length - 1]}, ${part}`;
    } else {
      markets.push(part);
    }
  }
  return markets;
}

function canonicalMarkets(value) {
  const names = [];
  for (const part of marketsOf(value)) {
    const mapped = MARKET_CANON[part];
    if (!mapped) throw new Error(`No canonical operating market for "${part}". Add it to MARKET_CANON.`);
    for (const name of mapped) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return sortMarkets(names);
}

function sortMarkets(names) {
  const regions = REGION_ORDER.filter((name) => names.includes(name));
  const countries = names.filter((name) => !REGION_ORDER.includes(name)).sort((a, b) => a.localeCompare(b));
  return [...regions, ...countries];
}


function splitList(value, separator) {
  return String(value || "")
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
}

function yearOf(iso, name) {
  const match = String(iso || "").match(/^(\d{4})-\d{2}-\d{2}$/);
  if (!match) throw new Error(`${name}: valuation_as_of must be YYYY-MM-DD`);
  return match[1];
}

function valuationOf(row) {
  const figure = row.valuation.trim();
  const source = row.valuation_source.trim();
  const asOf = row.valuation_as_of.trim();
  const notes = row.notes || "";
  const filled = [figure, source, asOf].filter(Boolean).length;
  if (filled === 0) return null;
  if (filled !== 3) {
    throw new Error(`${row.name}: valuation, valuation_source and valuation_as_of must all be present`);
  }
  const year = yearOf(asOf, row.name);
  if (/show with year/i.test(notes) && !year) {
    throw new Error(`${row.name}: notes say show with year, but the year is missing`);
  }
  if (row.name.trim().toLowerCase() === "neko health") {
    return { text: "reported ~US$7bn (2026)", source, year: "2026" };
  }
  return { text: `${figure} (${year})`, source, year };
}

function formatVerified(iso, name) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`${name}: last_verified must be YYYY-MM-DD`);
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

function initials(name) {
  const words = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function companyFromRow(row, city, kind, fileLabel) {
  const name = row.name.trim();
  if (!name) throw new Error(`${fileLabel}: a row has no name`);
  if (BANNED.some((banned) => name.toLowerCase().includes(banned))) {
    throw new Error(`${name} must not appear on a page`);
  }
  const status = row.fact_check_status.trim();
  if (status !== "PASS") {
    console.warn(`skip ${name}: fact_check_status is ${status}`);
    return null;
  }
  return {
    name,
    kind,
    slug: city.slug,
    city: city.label,
    logo: row.logo.trim(),
    initials: initials(name),
    short_description: row.short_description.trim(),
    founders: splitList(row.founders, ","),
    hq_city: row.hq_city.trim(),
    operating_markets: canonicalMarkets(row.operating_markets),
    website: row.website.trim(),
    sectors: splitList(row.sector, ";"),
    last_verified: formatVerified(row.last_verified.trim(), name),
    valuation: valuationOf(row),
  };
}

function loadCity(city) {
  return readFile(path.join(sourceDir, city.file), "utf8").then((raw) => (
    parseCsv(raw).map((row) => companyFromRow(row, city, "startup", city.file)).filter(Boolean)
  ));
}

function loadScaleUps() {
  return readFile(path.join(sourceDir, "scale-ups.csv"), "utf8").then((raw) => (
    parseCsv(raw).map((row) => {
      const label = (row.city || "").trim();
      const city = CITIES.find((item) => item.label === label);
      if (!city) throw new Error(`scale-ups.csv: unknown city "${label}" for ${row.name}`);
      return companyFromRow(row, city, "scale-up", "scale-ups.csv");
    }).filter(Boolean)
  ));
}

function awaitRead(file) {
  return readFile(file, "utf8");
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unique(values) {
  return [...new Set(values)];
}

const header = `<header class="header">
  <a href="/index.html" aria-label="GAIIN home" style="display:flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:#0d2951;flex-shrink:0;"><svg viewBox="0 0 132 70" fill="none" style="width:34px;height:auto;">
      <path d="M10 60 A 56 56 0 0 1 66 4" stroke="#dce7f2" stroke-width="10" stroke-linecap="round"/>
      <path d="M66 4 A 56 56 0 0 1 122 60" stroke="#7d9ac4" stroke-width="10" stroke-linecap="round"/>
      <circle cx="10" cy="60" r="10" fill="#dce7f2"/><circle cx="122" cy="60" r="10" fill="#d9877c"/>
    </svg></a>
  <nav class="nav-pill nav-pill--menu">
    <a href="/index.html#why">Why GAIIN</a>
    <a href="/index.html#network">The Network</a>
    <a href="/index.html#programmes">Programmes</a>
    <a href="/index.html#membership">Membership</a>
    <a href="/signal">Signal</a>
    <a href="/events">Events</a>
  </nav>
  <a class="header-linkedin" href="https://www.linkedin.com/company/gaiin-business-network/" target="_blank" rel="noopener noreferrer" aria-label="GAIIN on LinkedIn">
    <svg viewBox="0 0 32 32" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="liGradHeader" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stop-color="#0d2951"/>
          <stop offset="1" stop-color="#d9877c"/>
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#liGradHeader)"/>
      <path fill="#ffffff" d="M11.5 13h-3v9h3v-9zm-1.5-1.4c1 0 1.62-.66 1.62-1.48-.02-.84-.62-1.48-1.6-1.48s-1.62.64-1.62 1.48c0 .82.62 1.48 1.6 1.48zM22.5 22h.02v-4.94c0-2.43-1.3-3.56-3.03-3.56-1.4 0-2.02.77-2.37 1.32v-1.13h-3v9h3v-4.9c0-.26.02-.52.1-.7.22-.52.7-1.06 1.52-1.06 1.07 0 1.5.82 1.5 2.02V22h2.26z"/>
    </svg>
  </a>
  <button class="menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu"><span class="menu-toggle__bars" aria-hidden="true"></span></button>
  <nav class="mobile-menu" id="mobile-menu" aria-label="Site sections" hidden>
    <a href="/index.html#why">Why GAIIN</a>
    <a href="/index.html#network">The Network</a>
    <a href="/index.html#programmes">Programmes</a>
    <a href="/index.html#membership">Membership</a>
    <a href="/signal">Signal</a>
    <a href="/events">Events</a>
    <span class="mobile-menu__sep" aria-hidden="true"></span>
    <a href="https://www.linkedin.com/company/gaiin-business-network/" target="_blank" rel="noopener noreferrer">LinkedIn</a>
  </nav>
</header>`;

const footer = `<footer>
  <div class="footer-top">
    <div class="stack" style="gap:18px;">
      <svg viewBox="0 0 132 70" fill="none" style="width:56px;height:auto;">
      <path d="M10 60 A 56 56 0 0 1 66 4" stroke="#dce7f2" stroke-width="10" stroke-linecap="round"/>
      <path d="M66 4 A 56 56 0 0 1 122 60" stroke="#7d9ac4" stroke-width="10" stroke-linecap="round"/>
      <circle cx="10" cy="60" r="10" fill="#dce7f2"/><circle cx="122" cy="60" r="10" fill="#d9877c"/>
    </svg>
      <div class="footer-mark">Global Applied Intelligence<br>&amp; Innovation Network</div>
    </div>
    <nav class="footer-col">
      <a href="/index.html#why">Why GAIIN</a>
      <a href="/index.html#network">The Network</a>
      <a href="/index.html#programmes">Programmes</a>
      <a href="/index.html#membership">Membership</a>
      <a href="/signal">Signal</a>
      <a href="/events">Events</a>
    </nav>
    <div class="footer-col" style="gap:12px;">
      <a class="pill-cta pill-cta--primary" href="https://tally.so/r/dWoLBN" target="_blank" rel="noopener noreferrer" style="align-self:flex-start;">Request consideration</a>
      <a class="pill-cta pill-cta--secondary" href="https://tally.so/r/Zjk595" target="_blank" rel="noopener noreferrer" style="align-self:flex-start;">Recommend someone</a>
      <a href="/signal">Signal Briefs</a>
    </div>
  </div>
  <div class="footer-bottom">
    <span>© 2026 GAIIN</span>
    <span>Launched in Hong Kong and the Nordics. Connected globally.</span>
    <a class="social-link" href="https://www.linkedin.com/company/gaiin-business-network/" target="_blank" rel="noopener noreferrer" aria-label="GAIIN on LinkedIn">
    <svg viewBox="0 0 32 32" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="liGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stop-color="#0d2951"/>
          <stop offset="1" stop-color="#d9877c"/>
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="6" fill="url(#liGrad)"/>
      <path fill="#ffffff" d="M11.5 13h-3v9h3v-9zm-1.5-1.4c1 0 1.62-.66 1.62-1.48-.02-.84-.62-1.48-1.6-1.48s-1.62.64-1.62 1.48c0 .82.62 1.48 1.6 1.48zM22.5 22h.02v-4.94c0-2.43-1.3-3.56-3.03-3.56-1.4 0-2.02.77-2.37 1.32v-1.13h-3v9h3v-4.9c0-.26.02-.52.1-.7.22-.52.7-1.06 1.52-1.06 1.07 0 1.5.82 1.5 2.02V22h2.26z"/>
    </svg>
  </a>
  </div>
</footer>
<script src="/assets/mobile-nav.js" defer></script>`;

const css = `
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #0a1730; }
  body { overflow-x: hidden; font-family: 'Libre Franklin', sans-serif; color: #f7f9fb; -webkit-font-smoothing: antialiased; }
  ::selection { background: #d9877c; color: #0a1730; }
  a { text-decoration: none; }
  h1, h2, h3 { margin: 0; font-family: 'Playfair Display', serif; font-weight: 400; letter-spacing: -0.02em; }
  p { margin: 0; }
  @keyframes gaiin-pulse { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: -1000; } }
  @keyframes gaiin-flicker { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
  .pulse { animation: gaiin-pulse 10s linear infinite; }
  .cube { width: 8px; height: 8px; background: #d9877c; display: block; animation: gaiin-flicker 1.4s ease-in-out infinite; }
  .header { position: fixed; top: 0; left: 0; right: 0; z-index: 40; padding: 20px clamp(16px,3vw,40px); display: flex; align-items: center; justify-content: space-between; gap: 16px; pointer-events: none; }
  .header > * { pointer-events: auto; }
  .nav-pill { display: flex; align-items: center; gap: 4px; background: #0d2951; border-radius: 999px; padding: 6px; flex-wrap: wrap; justify-content: center; }
  .nav-pill a { font-family: 'Fragment Mono', monospace; font-size: 12px; letter-spacing: .04em; color: #dce7f2; padding: 9px 14px; border-radius: 999px; transition: background-color .2s, color .2s; white-space: nowrap; }
  .nav-pill a:hover { background: #16305a; color: #fff; }
  @media (max-width: 720px) { .nav-pill--menu { display: none; } }
  .header-linkedin { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: #0d2951; flex-shrink: 0; transition: transform .2s, opacity .2s; }
  .header-linkedin:hover { transform: translateY(-2px); opacity: .85; }
  .menu-toggle { display: none; align-items: center; justify-content: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%; background: #0d2951; color: #EDB3A8; cursor: pointer; flex-shrink: 0; }
  .menu-toggle:hover, .menu-toggle[aria-expanded="true"] { color: #d9877c; }
  .menu-toggle:focus-visible { outline: 2px solid #EDB3A8; outline-offset: 3px; }
  .menu-toggle__bars { position: relative; display: block; width: 18px; height: 2px; border-radius: 2px; background: currentColor; }
  .menu-toggle__bars::before, .menu-toggle__bars::after { content: ""; position: absolute; left: 0; width: 18px; height: 2px; border-radius: 2px; background: currentColor; }
  .menu-toggle__bars::before { transform: translateY(-6px); }
  .menu-toggle__bars::after { transform: translateY(6px); }
  .menu-toggle[aria-expanded="true"] .menu-toggle__bars { background: transparent; }
  .menu-toggle[aria-expanded="true"] .menu-toggle__bars::before { transform: rotate(45deg); }
  .menu-toggle[aria-expanded="true"] .menu-toggle__bars::after { transform: rotate(-45deg); }
  .mobile-menu { position: absolute; top: calc(100% - 8px); left: clamp(16px,3vw,40px); right: clamp(16px,3vw,40px); background: #0a1730; border: 1px solid rgba(237,179,168,.35); border-radius: 20px; padding: 10px; display: flex; flex-direction: column; gap: 2px; }
  .mobile-menu[hidden] { display: none; }
  .mobile-menu a { font-family: 'Fragment Mono', monospace; font-size: 13px; letter-spacing: .04em; color: #dce7f2; padding: 13px 14px; border-radius: 12px; }
  .mobile-menu a:hover { background: #0d2951; color: #d9877c; }
  .mobile-menu__sep { height: 1px; margin: 6px 14px; background: rgba(201,167,158,.3); }
  @media (max-width: 720px) { .header-linkedin { display: none; } .menu-toggle { display: inline-flex; } }
  @media (min-width: 721px) { .mobile-menu { display: none !important; } }
  section { padding: clamp(56px,8vw,120px) clamp(20px,4vw,64px); }
  .hero { position: relative; background: #0d2951; display: flex; align-items: flex-end; padding: clamp(120px,18vh,180px) clamp(20px,4vw,64px) clamp(48px,7vh,88px); overflow: hidden; }
  .bg-lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .band { height: 56px; }
  .band--to-light { background: #0d2951; background-image: linear-gradient(#0a1730 50%, transparent 50%), repeating-linear-gradient(90deg, #0a1730 0 24px, transparent 24px 48px); background-size: 100% 100%, 48px 28px; background-position: 0 28px, 0 0; background-repeat: no-repeat, repeat-x; }
  .band--to-dark { background: #0a1730; background-image: linear-gradient(#0a1730 50%, transparent 50%), repeating-linear-gradient(90deg, #0d2951 0 24px, transparent 24px 48px); background-size: 100% 100%, 48px 28px; background-position: 0 28px, 0 0; background-repeat: no-repeat, repeat-x; }
  .eyebrow { display: flex; align-items: center; gap: 10px; font-family: 'Fragment Mono', monospace; font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: #7d9ac4; }
  .h1 { font-size: clamp(40px,6vw,84px); line-height: 1.02; color: #f7f9fb; }
  .lede { font-size: 15px; line-height: 1.7; color: #a8bcd8; max-width: 640px; }
  .note { font-family: 'Fragment Mono', monospace; font-size: 11.5px; line-height: 1.65; color: #a8bcd8; max-width: 720px; }
  .stack { display: flex; flex-direction: column; }
  footer { background: #0a1730; color: #8ea5c4; padding: clamp(40px,5vw,70px) clamp(20px,4vw,64px); display: flex; flex-direction: column; gap: 32px; }
  .footer-top { display: flex; flex-wrap: wrap; gap: 32px; justify-content: space-between; align-items: flex-start; }
  .footer-col { display: flex; flex-direction: column; gap: 12px; font-family: 'Fragment Mono', monospace; font-size: 12px; }
  .footer-col a { color: #8ea5c4; }
  .footer-col a:hover { color: #d9877c; }
  .footer-mark { font-family: 'Fragment Mono', monospace; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #7d9ac4; }
  .footer-bottom { border-top: 1px solid #1c2f52; padding-top: 20px; display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; align-items: center; font-family: 'Fragment Mono', monospace; font-size: 11px; color: #5d7599; }
  .social-link { display: inline-flex; }
  .pill-cta { display: inline-flex; align-items: center; font-family: 'Fragment Mono', monospace; font-size: 11.5px; letter-spacing: .04em; padding: 8px 18px; border-radius: 999px; }
  .pill-cta--primary { background: #16305a; color: #dce7f2; }
  .pill-cta--secondary { background: #0d2951; color: #a8bcd8; }
  .wrap { max-width: 960px; display: flex; flex-direction: column; gap: 22px; }
  .search { display: flex; }
  .search input { width: 100%; background: #0d2951; color: #f7f9fb; border: 1px solid #1c2f52; border-radius: 999px; padding: 12px 18px; font-family: 'Libre Franklin', sans-serif; font-size: 15px; }
  .search input:focus-visible { outline: 2px solid #EDB3A8; outline-offset: 2px; }
  .filters { display: flex; flex-direction: column; gap: 10px; }
  .filters__row { display: flex; flex-wrap: wrap; gap: 8px; }
  .filter-block { display: flex; align-items: flex-start; gap: 8px; }
  .filters__row--clamp { flex: 1 1 auto; min-width: 0; max-height: 34px; overflow: hidden; }
  .filters__row--clamp.is-open { max-height: none; }
  .filter-more[hidden] { display: none; }
  .filter-select { display: none; flex-direction: column; gap: 6px; }
  .filter-select__label { font-family: 'Fragment Mono', monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #8ea5c4; }
  .filter-select select { width: 100%; appearance: none; background: #0d2951; color: #f7f9fb; border: 1px solid #EDB3A8; border-radius: 999px; padding: 10px 16px; font-family: 'Fragment Mono', monospace; font-size: 12px; letter-spacing: .04em; }
  .filter-select select:focus-visible { outline: 2px solid #EDB3A8; outline-offset: 2px; }
  @media (max-width: 639px) {
    .filter-block { display: none; }
    .filter-select { display: flex; }
  }
  .filter-chip { font-family: 'Fragment Mono', monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #EDB3A8; background: transparent; border: 1px solid #EDB3A8; border-radius: 999px; padding: 7px 14px; cursor: pointer; }
  .filter-chip:hover { border-color: #d9877c; color: #d9877c; }
  .filter-chip[aria-pressed="true"], .filter-chip[aria-current="page"] { color: #0a1730; background: #d9877c; border-color: #d9877c; }
  .filter-chip[aria-pressed="true"]:hover, .filter-chip[aria-current="page"]:hover { color: #0a1730; }
  .filter-chip:focus-visible { outline: 2px solid #EDB3A8; outline-offset: 2px; }
  .filter-chip--region { color: #ffffff; border-color: #ffffff; }
  .filter-chip--region:hover { color: #ffffff; border-color: #ffffff; }
  .filter-chip--region[aria-pressed="true"], .filter-chip--region[aria-current="page"],
  .filter-chip--region[aria-pressed="true"]:hover, .filter-chip--region[aria-current="page"]:hover { color: #0a1730; background: #ffffff; border-color: #ffffff; }
  .filter-chip--region:focus-visible { outline-color: #ffffff; }
  .list { display: flex; flex-direction: column; gap: 12px; scroll-margin-top: 108px; }
  .list.is-startups [data-kind="scale-up"],
  .list.is-scale-ups [data-kind="startup"] { display: none !important; }
  .startup-card { display: grid; grid-template-columns: 168.75px minmax(0, 1fr); column-gap: 18px; row-gap: 8px; align-items: start; padding: 16px; background: #0d2951; border: 1px solid #1c2f52; border-radius: 16px; }
  .startup-card[hidden] { display: none; }
  .startup-card__media { position: relative; grid-column: 1; grid-row: 1 / span 2; width: 168.75px; height: 168.75px; border-radius: 14px; overflow: hidden; flex-shrink: 0; }
  .startup-card__media--light { background: #f7f9fb; }
  .startup-card__media--navy { background: #0a1730; border: 1px solid rgba(237,179,168,.45); }
  .kind-toggle { display: flex; gap: 8px; }
  .stage-title { font-size: clamp(28px, 3.4vw, 42px); color: #f7f9fb; scroll-margin-top: 108px; }
  .startup-card__media img, .logo-fallback { position: absolute; inset: 0; width: 100%; height: 100%; }
  .startup-card__media img { object-fit: contain; display: block; padding: 14px; }
  .logo-fallback { display: flex; align-items: center; justify-content: center; font-family: 'Fragment Mono', monospace; font-size: 28px; letter-spacing: .08em; }
  .startup-card__media--light .logo-fallback { color: #0a1730; }
  .startup-card__media--navy .logo-fallback { color: #EDB3A8; }
  .startup-card__body { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; width: 100%; grid-column: 2; grid-row: 1; }
  .startup-card__foot { display: flex; flex-wrap: nowrap; align-items: baseline; justify-content: space-between; gap: 8px 12px; width: 100%; grid-column: 2; grid-row: 2; }
  .startup-card__topline { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; width: 100%; }
  .startup-card__sector { font-family: 'Fragment Mono', monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #EDB3A8; }
  .startup-card__name { font-size: clamp(22px,2vw,28px); line-height: 1.15; color: #f7f9fb; }
  .startup-card__desc { font-size: 15px; line-height: 1.6; color: #a8bcd8; }
  .startup-card__meta { font-size: 14px; line-height: 1.5; color: #8ea5c4; }
  .market-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .market-chip { font-family: 'Fragment Mono', monospace; font-size: 9px; letter-spacing: .06em; line-height: 1.4; text-transform: uppercase; color: #EDB3A8; border: 1px solid #EDB3A8; border-radius: 999px; padding: 2px 6px; }
  .startup-card__value a { color: #d9877c; border-bottom: 1px solid #d9877c; font-family: 'Fragment Mono', monospace; font-size: 12px; }
  .startup-card__value a:hover { color: #EDB3A8; border-color: #EDB3A8; }
  .link-under { font-family: 'Fragment Mono', monospace; font-size: 11px; letter-spacing: .04em; color: #d9877c; border-bottom: 1px solid #d9877c; white-space: nowrap; }
  .link-under:hover { color: #EDB3A8; border-color: #EDB3A8; }
  .startup-card__verified { font-family: 'Fragment Mono', monospace; font-size: 11px; letter-spacing: .04em; color: #8ea5c4; white-space: nowrap; }
  .map-section { background: #0a1730; padding-top: clamp(20px, 3vw, 36px); padding-bottom: 0; }
  .list-section { padding-top: clamp(12px, 2vw, 24px); }
  .map-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 18px; }
  .map-legend { display: flex; flex-wrap: wrap; gap: 14px 18px; font-family: 'Fragment Mono', monospace; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #8ea5c4; }
  .map-legend__item { display: inline-flex; align-items: center; gap: 8px; }
  .map-legend__swatch { width: 9px; height: 9px; border-radius: 50%; background: #d9877c; opacity: .7; box-shadow: 0 0 0 4px rgba(217,135,124,.28); }
  .map-legend__swatch--hq { width: 13px; height: 13px; opacity: 1; box-shadow: 0 0 0 5px rgba(217,135,124,.4); }
  .map-frame { position: relative; width: 100%; margin-top: 4px; line-height: 0; }
  .world-map { width: 100%; height: auto; display: block; overflow: hidden; vertical-align: top; }
  .map-country { fill: #17345c; stroke: #0a1730; stroke-width: 0.7; }
  .map-country--link { cursor: pointer; }
  .map-country--link:hover, .map-country--link:focus-visible { fill: #214872; outline: none; }
  .map-country--link[aria-pressed="true"] { fill: #2c5d8f; }
  .map-markers { position: absolute; inset: 0; }
  .map-marker { position: absolute; width: 36px; height: 36px; margin: 0; padding: 0; border: 0; border-radius: 50%; background: transparent; transform: translate(-50%, -50%); cursor: pointer; z-index: 1; }
  .map-marker[data-country="Hong Kong"] { transform: translate(calc(-50% - 16px), calc(-50% + 6px)); z-index: 3; }
  .map-marker[data-country="Taiwan"] { transform: translate(calc(-50% + 16px), calc(-50% - 10px)); }
  .map-pin { position: absolute; width: 10px; height: 10px; border-radius: 50%; background: #d9877c; transform: translate(-50%, -50%); pointer-events: none; box-shadow: 0 0 0 4px rgba(217,135,124,.35); }
  .nordics { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; line-height: normal; }
  .nordics__label { font-family: 'Fragment Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8ea5c4; }
  .nordic-hit { position: relative; transform: none; left: auto; top: auto; width: auto; min-width: 36px; min-height: 36px; display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px 4px 8px; border-radius: 999px; border: 1px solid #d9877c; background: transparent; color: #EDB3A8; font-family: 'Fragment Mono', monospace; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; }
  .nordic-hit .map-marker__dot { position: static; transform: none; flex: 0 0 auto; }
  .nordic-hit .map-marker__pulse { display: none; }
  .nordic-hit[aria-pressed="true"] { color: #0a1730; background: #d9877c; border-color: #d9877c; }
  .nordic-hit[aria-pressed="true"] .map-marker__dot { background: #0a1730; box-shadow: none; }
  .nordic-hit:focus-visible { outline: 2px solid #EDB3A8; outline-offset: 2px; }
  .map-marker--hq { z-index: 2; }
  .map-marker:focus-visible { outline: 2px solid #EDB3A8; outline-offset: 2px; }
  .map-marker__dot { position: absolute; left: 50%; top: 50%; width: 9px; height: 9px; border-radius: 50%; background: #d9877c; opacity: .75; transform: translate(-50%, -50%); box-shadow: 0 0 0 4px rgba(217,135,124,.28); }
  .map-marker--hq .map-marker__dot { width: 14px; height: 14px; opacity: 1; box-shadow: 0 0 0 6px rgba(217,135,124,.4); }
  .map-marker[aria-pressed="true"] .map-marker__dot { box-shadow: 0 0 0 3px #0a1730, 0 0 0 6px #d9877c; }
  .map-marker__pulse { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; border-radius: 50%; background: rgba(217,135,124,.45); transform: translate(-50%, -50%); animation: map-pulse 2.2s ease-out infinite; }
  .map-marker--hq .map-marker__pulse { width: 18px; height: 18px; background: rgba(217,135,124,.55); }
  @keyframes map-pulse { 0% { transform: translate(-50%, -50%) scale(1); opacity: .7; } 100% { transform: translate(-50%, -50%) scale(1.85); opacity: 0; } }
  .map-tip { position: absolute; z-index: 3; transform: translate(-50%, calc(-100% - 16px)); margin: 0; padding: 4px 8px; border-radius: 999px; background: #0d2951; border: 1px solid #d9877c; color: #f7f9fb; font-family: 'Fragment Mono', monospace; font-size: 11px; letter-spacing: .04em; white-space: nowrap; pointer-events: none; }
  .map-tip[hidden] { display: none; }
  @media (prefers-reduced-motion: reduce) {
    .pulse { animation: none; }
    .map-marker__pulse { animation: none; opacity: 0; }
  }
  .empty { font-size: 15px; line-height: 1.7; color: #a8bcd8; }
  .empty[hidden] { display: none; }
  @media (max-width: 720px) {
    .startup-card { grid-template-columns: 116px minmax(0, 1fr); column-gap: 15px; align-items: start; padding: 12px; }
    .startup-card__media { grid-row: 1; width: 116px; height: 116px; border-radius: 12px; }
    .startup-card__foot { grid-column: 1 / -1; grid-row: 2; }
    .startup-card__name { font-size: 18px; }
    .startup-card__desc { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
    .logo-fallback { font-size: 20px; }
  }
`;

function mediaClass(name) {
  return DARK_LOGO.includes(name)
    ? "startup-card__media startup-card__media--navy"
    : "startup-card__media startup-card__media--light";
}

const CITY_COUNTRY = {
  "Hong Kong": "Hong Kong",
  Stockholm: "Sweden",
  Copenhagen: "Denmark",
  Oslo: "Norway",
};

const COUNTRY_PLACES = [
  { id: "Hong Kong", lon: 114.17, lat: 22.32, iso: null, markets: ["Hong Kong"] },
  { id: "Sweden", lon: 16.3, lat: 62.8, iso: "752", markets: ["Sweden"] },
  { id: "Denmark", lon: 9.5, lat: 56.1, iso: "208", markets: ["Denmark"] },
  { id: "Norway", lon: 9.5, lat: 64.5, iso: "578", markets: ["Norway"] },
  { id: "Germany", lon: 10.4, lat: 51.2, iso: "276", markets: ["Germany"] },
  { id: "Netherlands", lon: 5.3, lat: 52.2, iso: "528", markets: ["Netherlands"] },
  { id: "Taiwan", lon: 120.96, lat: 23.7, iso: "158", markets: ["Taiwan"] },
  { id: "UAE", lon: 54.3, lat: 24.2, iso: "784", markets: ["UAE"] },
  { id: "UK", lon: -2.6, lat: 54.2, iso: "826", markets: ["UK"] },
  { id: "US", lon: -98.35, lat: 39.5, iso: "840", markets: ["US"] },
  { id: "Singapore", lon: 103.82, lat: 1.35, iso: "702", markets: ["Singapore"] },
];

const MARKET_COUNTRY = Object.fromEntries(
  COUNTRY_PLACES.flatMap((place) => place.markets.map((market) => [market, place.id])),
);

const WORLD_W = 960;
const LAT_MAX = 83;
const LAT_MIN = -56;
const WORLD_H = Math.round((WORLD_W * (LAT_MAX - LAT_MIN)) / 360);
const NORDICS = new Set(["Sweden", "Denmark", "Norway"]);

function companyCountries(company) {
  const found = new Set();
  const hq = CITY_COUNTRY[company.city];
  if (hq) found.add(hq);
  for (const market of company.operating_markets) {
    const country = MARKET_COUNTRY[market];
    if (country) found.add(country);
  }
  return [...found];
}

function project(lon, lat) {
  return [
    ((lon + 180) / 360) * WORLD_W,
    ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * WORLD_H,
  ];
}

let projectPoint = project;

function decodeArcs(topo) {
  const { scale, translate } = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
}

function ringPath(ring) {
  const parts = [];
  let part = [];
  ring.forEach(([lon, lat], index) => {
    if (index > 0 && Math.abs(lon - ring[index - 1][0]) > 180) {
      if (part.length) parts.push(part);
      part = [];
    }
    part.push([lon, lat]);
  });
  if (part.length) parts.push(part);
  return parts.filter((points) => points.length > 2).map((points) => {
    let d = "";
    points.forEach(([lon, lat], index) => {
      const [x, y] = projectPoint(lon, lat);
      d += `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return `${d}Z`;
  }).join("");
}

function geometryPath(geometry, arcs) {
  const polygons = geometry.type === "Polygon" ? [geometry.arcs] : geometry.arcs;
  let d = "";
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const coords = [];
      ring.forEach((index, ringIndex) => {
        const points = index < 0 ? arcs[~index].slice().reverse() : arcs[index];
        coords.push(...(ringIndex === 0 ? points : points.slice(1)));
      });
      if (coords.length) d += ringPath(coords);
    }
  }
  return d;
}

function countryCounts(list) {
  const counts = Object.fromEntries(COUNTRY_PLACES.map((place) => [place.id, 0]));
  for (const company of list) {
    for (const id of companyCountries(company)) {
      if (Object.prototype.hasOwnProperty.call(counts, id)) counts[id] += 1;
    }
  }
  return counts;
}

function countLabel(id, count, kind) {
  const noun = kind === "scale-up"
    ? (count === 1 ? "scale-up" : "scale-ups")
    : (count === 1 ? "startup" : "startups");
  return `${id}, ${count} ${noun}`;
}

function mapSection(startups, scaleUps, topo) {
  const startupCounts = countryCounts(startups);
  const scaleCounts = countryCounts(scaleUps);
  const hqIds = new Set();
  for (const company of [...startups, ...scaleUps]) {
    const hq = CITY_COUNTRY[company.city];
    if (hq) hqIds.add(hq);
  }
  const places = COUNTRY_PLACES
    .map((place) => ({
      ...place,
      hq: hqIds.has(place.id),
      startupCount: startupCounts[place.id],
      scaleCount: scaleCounts[place.id],
    }))
    .filter((place) => place.startupCount > 0 || place.scaleCount > 0)
    .sort((a, b) => Number(a.hq) - Number(b.hq));
  const arcs = decodeArcs(topo);
  const byIso = new Map(places.filter((place) => place.iso).map((place) => [place.iso, place]));
  const paths = topo.objects.countries.geometries.map((geometry) => {
    const d = geometryPath(geometry, arcs);
    if (!d) return "";
    const place = byIso.get(String(geometry.id));
    if (!place) return `<path class="map-country" d="${d}"></path>`;
    const label = countLabel(place.id, place.startupCount, "startup");
    const hidden = place.startupCount === 0 ? " hidden" : "";
    return `<path class="map-country map-country--link" data-country="${esc(place.id)}" data-startup-count="${place.startupCount}" data-scale-count="${place.scaleCount}" role="button" tabindex="${place.startupCount === 0 ? "-1" : "0"}" aria-pressed="false" aria-label="${esc(label)}"${hidden} d="${d}"></path>`;
  }).join("");
  const markers = places.map((place) => {
    const [x, y] = project(place.lon, place.lat);
    const label = countLabel(place.id, place.startupCount, "startup");
    const left = ((x / WORLD_W) * 100).toFixed(2);
    const top = ((y / WORLD_H) * 100).toFixed(2);
    const hidden = place.startupCount === 0 ? " hidden" : "";
    if (NORDICS.has(place.id)) {
      return `<span class="map-pin" data-country="${esc(place.id)}" data-startup-count="${place.startupCount}" data-scale-count="${place.scaleCount}" style="left:${left}%;top:${top}%" aria-hidden="true"${hidden}></span>`;
    }
    const kind = place.hq ? "map-marker map-marker--hq" : "map-marker";
    return `<button class="${kind}" type="button" data-country="${esc(place.id)}" data-startup-count="${place.startupCount}" data-scale-count="${place.scaleCount}" data-label="${esc(label)}" aria-pressed="false" aria-label="${esc(label)}" style="left:${left}%;top:${top}%"${hidden}><span class="map-marker__pulse" aria-hidden="true"></span><span class="map-marker__dot" aria-hidden="true"></span></button>`;
  }).join("");
  const nordicOrder = ["Norway", "Sweden", "Denmark"];
  const nordicPlaces = nordicOrder.map((id) => places.find((place) => place.id === id)).filter(Boolean);
  const insetMarkers = nordicPlaces.map((place) => {
    const label = countLabel(place.id, place.startupCount, "startup");
    const hidden = place.startupCount === 0 ? " hidden" : "";
    return `<button class="nordic-hit" type="button" data-country="${esc(place.id)}" data-startup-count="${place.startupCount}" data-scale-count="${place.scaleCount}" data-label="${esc(label)}" aria-pressed="false" aria-label="${esc(label)}"${hidden}><span class="map-marker__dot" aria-hidden="true"></span>${esc(place.id)}</button>`;
  }).join("");
  const nordics = `<div class="nordics" role="group" aria-label="Nordics"><span class="nordics__label">Nordics</span>${insetMarkers}</div>`;
  return `<section class="map-section" id="startup-map" aria-label="Filter by country">
  <div class="wrap">
    <div class="map-bar">
      <button class="filter-chip filter-chip--region" type="button" data-map-reset aria-pressed="true" aria-label="All countries">All</button>
      <p class="map-legend">
        <span class="map-legend__item"><span class="map-legend__swatch map-legend__swatch--hq" aria-hidden="true"></span>Headquarters</span>
        <span class="map-legend__item"><span class="map-legend__swatch" aria-hidden="true"></span>Operating market</span>
      </p>
    </div>
    <div class="map-frame">
      <svg class="world-map" viewBox="0 0 ${WORLD_W} ${WORLD_H}" fill-rule="evenodd" role="group" aria-label="World map. Choose a country to filter the list.">${paths}</svg>
      <div class="map-markers">${markers}</div>
      <p class="map-tip" id="map-tip" role="status" hidden></p>
    </div>
    ${nordics}
  </div>
</section>`;
}

function cardHtml(company) {
  const search = [
    company.name,
    company.short_description,
    company.founders.join(" "),
    company.hq_city,
    company.city,
    company.operating_markets.join(" "),
    company.sectors.join(" "),
  ].join(" ").toLowerCase();
  const countries = companyCountries(company);
  const logo = company.logo
    ? `<img src="${esc(company.logo)}" alt="" width="400" height="400" loading="lazy" data-initials="${esc(company.initials)}">`
    : `<span class="logo-fallback">${esc(company.initials)}</span>`;
  const founders = company.founders.length
    ? `<p class="startup-card__meta">Founders: ${esc(company.founders.join(", "))}</p>`
    : "";
  const markets = sortMarkets(company.operating_markets).map((market) => `<span class="market-chip">${esc(market)}</span>`).join("");
  const valuation = company.valuation
    ? `<p class="startup-card__value"><a href="${esc(company.valuation.source)}" target="_blank" rel="noopener noreferrer">${esc(company.valuation.text)}</a></p>`
    : "";
  const website = company.website
    ? `<a class="link-under" href="${esc(company.website)}" target="_blank" rel="noopener noreferrer">Website</a>`
    : "";
  return `<article class="startup-card" data-kind="${esc(company.kind)}" data-search="${esc(search)}" data-markets="${esc(company.operating_markets.join("|"))}" data-sectors="${esc(company.sectors.join("|"))}" data-countries="${esc(countries.join("|"))}">
    <div class="${mediaClass(company.name)}">${logo}</div>
    <div class="startup-card__body">
      <div class="startup-card__topline">
        <p class="startup-card__sector">${esc(company.sectors.join(" · "))}</p>
        <div class="market-chips">${markets}</div>
      </div>
      <h2 class="startup-card__name">${esc(company.name)}</h2>
      <p class="startup-card__desc">${esc(company.short_description)}</p>
      ${founders}
      <p class="startup-card__meta">HQ: ${esc(company.hq_city)}</p>
      ${valuation}
    </div>
    <div class="startup-card__foot">
      ${website}
      <p class="startup-card__verified">Last verified ${esc(company.last_verified)}</p>
    </div>
  </article>`;
}

function chipLink(href, label, region, current) {
  const classes = region ? "filter-chip filter-chip--region" : "filter-chip";
  const currentAttr = current ? ' aria-current="page"' : "";
  return `<a class="${classes}" href="${href}"${currentAttr}>${esc(label)}</a>`;
}

function chipButton(label, kind, value, pressed) {
  return `<button class="filter-chip" type="button" data-filter="${esc(kind)}" data-value="${esc(value)}" aria-pressed="${pressed ? "true" : "false"}">${esc(label)}</button>`;
}

function selectFilter(kind, label, values) {
  const options = [`<option value="">All</option>`, ...values.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`)].join("");
  return `<label class="filter-select"><span class="filter-select__label">${esc(label)}</span><select data-filter="${esc(kind)}" aria-label="${esc(label)}">${options}</select></label>`;
}

function pillBlock(kind, label, buttons) {
  return `<div class="filter-block">
        <div class="filters__row filters__row--clamp" data-clamp="${esc(kind)}" role="group" aria-label="${esc(label)}">${buttons}</div>
        <button class="filter-chip filter-more" type="button" data-expand="${esc(kind)}" hidden aria-expanded="false">More</button>
      </div>`;
}

function pageHtml({ title, pathName, heading, companies, scaleUps, activeSlug, topo }) {
  const pool = [...companies, ...scaleUps];
  const markets = sortMarkets(unique(pool.flatMap((company) => company.operating_markets)));
  const sectors = SECTOR_ORDER.filter((sector) => pool.some((company) => company.sectors.includes(sector)));
  const cityLinks = [
    chipLink("/startups", "All", true, activeSlug === "all"),
    ...CITIES.map((city) => chipLink(`/startups/${city.slug}`, city.label, false, activeSlug === city.slug)),
  ].join("");
  const marketButtons = [chipButton("All", "market", "", true), ...markets.map((market) => chipButton(market, "market", market, false))].join("");
  const sectorButtons = [chipButton("All", "sector", "", true), ...sectors.map((sector) => chipButton(sector, "sector", sector, false))].join("");
  const index = activeSlug === "all";
  const lists = index
    ? `<div class="kind-toggle" role="group" aria-label="Company stage">
      <button class="filter-chip" type="button" data-stage="startup" aria-pressed="true">Startups</button>
      <button class="filter-chip" type="button" data-stage="scale-up" aria-pressed="false">Scale-ups</button>
    </div>
    <div class="list is-startups" id="startup-list">
      ${[...companies, ...scaleUps].map(cardHtml).join("\n")}
    </div>
    <p class="empty" id="startup-empty" hidden>No matching startups.</p>`
    : `<h2 class="stage-title">Startups</h2>
    <div class="list" id="startup-list">
      ${companies.map(cardHtml).join("\n")}
    </div>
    <p class="empty" id="startup-empty" data-empty="startup" hidden>No matching startups.</p>
    <h2 class="stage-title" id="scale-ups">Scale-ups</h2>
    <div class="list" id="scale-list">
      ${scaleUps.map(cardHtml).join("\n")}
    </div>
    <p class="empty" id="scale-empty" data-empty="scale-up" hidden>No matching scale-ups.</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<meta name="description" content="GAIIN Startup Database. Provisional.">
<meta property="og:site_name" content="GAIIN">
<meta property="og:title" content="${esc(title)}">
<meta property="og:url" content="https://www.gaiin.xyz${pathName}">
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-GEP58HBY4R"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-GEP58HBY4R');
</script>
<!-- Vercel Web Analytics -->
<script>
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
</script>
<script defer src="/_vercel/insights/script.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fragment+Mono&family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400&family=Libre+Franklin:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
${header}
<main class="hero" id="top">
  <svg class="bg-lines" viewBox="0 0 1920 900" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
    <defs><linearGradient id="heroGrad" x1="0" y1="900" x2="1920" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#dce7f2" stop-opacity="0"/><stop offset="0.5" stop-color="#dce7f2"/><stop offset="1" stop-color="#dce7f2" stop-opacity="0"/></linearGradient></defs>
    <path d="M-40 880H520C531 880 540 871 540 860V600C540 589 549 580 560 580H900C911 580 920 571 920 560V320C920 309 929 300 940 300H1480C1491 300 1500 291 1500 280V80C1500 69 1509 60 1520 60H1980" stroke="url(#heroGrad)" stroke-opacity="0.28" stroke-width="1"/>
    <path class="pulse" d="M-40 880H520C531 880 540 871 540 860V600C540 589 549 580 560 580H900C911 580 920 571 920 560V320C920 309 929 300 940 300H1480C1491 300 1500 291 1500 280V80C1500 69 1509 60 1520 60H1980" stroke="#d9877c" stroke-width="1.6" fill="none" pathLength="1000" stroke-dasharray="110 890"/>
  </svg>
  <div style="position:relative;width:100%;display:flex;flex-direction:column;gap:clamp(22px,3.4vw,40px);">
    <div class="eyebrow"><span class="cube"></span><span>Startup database</span></div>
    <h1 class="h1">${esc(heading)}</h1>
    <p class="lede">TODO (Comms): one sentence introducing this database.</p>
  </div>
</main>
<div class="band band--to-light"></div>
${index ? mapSection(companies, scaleUps, topo) : ""}
<section class="list-section" style="background:#0a1730;">
  <div class="wrap">
    <form class="search" role="search" onsubmit="return false">
      <label class="visually-hidden" for="startup-search" style="position:absolute;width:1px;height:1px;overflow:hidden;">Search startups</label>
      <input id="startup-search" type="search" placeholder="Search name, founder, or market" autocomplete="off">
    </form>
    <div class="filters">
      <div class="filters__row" role="navigation" aria-label="City">${cityLinks}</div>
      ${pillBlock("market", "Operating market", marketButtons)}
      ${selectFilter("market", "Operating market", markets)}
      ${pillBlock("sector", "Sector", sectorButtons)}
      ${selectFilter("sector", "Sector", sectors)}
    </div>
    ${lists}
    <p class="note">Logos belong to their owners. Listed company? Request changes: TODO (contact).</p>
  </div>
</section>
<div class="band band--to-dark"></div>
${footer}
<script>
(function () {
  var search = document.getElementById("startup-search");
  var cards = Array.prototype.slice.call(document.querySelectorAll(".startup-card"));
  var empty = document.getElementById("startup-empty");
  var market = "";
  var sector = "";
  var country = "";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var tip = document.getElementById("map-tip");
  var MARKET_COUNTRY = {
    "Hong Kong": "Hong Kong",
    "Sweden": "Sweden",
    "Denmark": "Denmark",
    "Norway": "Norway",
    "Germany": "Germany",
    "Netherlands": "Netherlands",
    "Taiwan": "Taiwan",
    "UAE": "UAE",
    "UK": "UK",
    "US": "US",
    "Singapore": "Singapore"
  };
  var kind = "startup";
  var stageToggle = document.querySelector(".kind-toggle");

  document.querySelectorAll("[data-logo], .startup-card__media img").forEach(function (img) {
    function fail() {
      var tile = document.createElement("span");
      tile.className = "logo-fallback";
      tile.textContent = img.getAttribute("data-initials") || "";
      img.replaceWith(tile);
    }
    img.addEventListener("error", fail);
    if (img.complete && img.naturalWidth === 0) fail();
  });

  function apply() {
    var query = search.value.trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (card) {
      var markets = (card.getAttribute("data-markets") || "").split("|").filter(Boolean);
      var sectors = (card.getAttribute("data-sectors") || "").split("|").filter(Boolean);
      var countries = (card.getAttribute("data-countries") || "").split("|").filter(Boolean);
      var cardKind = card.getAttribute("data-kind") || "startup";
      var ok = (!query || (card.getAttribute("data-search") || "").indexOf(query) !== -1)
        && (!market || markets.indexOf(market) !== -1)
        && (!sector || sectors.indexOf(sector) !== -1)
        && (!country || countries.indexOf(country) !== -1)
        && (!stageToggle || cardKind === kind);
      card.hidden = !ok;
      if (ok) shown += 1;
    });
    if (stageToggle) {
      empty.hidden = shown !== 0;
      empty.textContent = kind === "scale-up" ? "No matching scale-ups." : "No matching startups.";
    } else {
      ["startup", "scale-up"].forEach(function (group) {
        var groupShown = cards.filter(function (card) {
          return (card.getAttribute("data-kind") || "startup") === group && !card.hidden;
        }).length;
        var node = document.querySelector('[data-empty="' + group + '"]');
        if (node) node.hidden = groupShown !== 0;
      });
    }
  }

  function mapNoun(count) {
    if (kind === "scale-up") return count === 1 ? "scale-up" : "scale-ups";
    return count === 1 ? "startup" : "startups";
  }

  function syncMap() {
    document.querySelectorAll("[data-startup-count]").forEach(function (el) {
      var count = Number(el.getAttribute(kind === "scale-up" ? "data-scale-count" : "data-startup-count") || "0");
      var id = el.getAttribute("data-country");
      if (!id) return;
      var label = id + ", " + count + " " + mapNoun(count);
      el.setAttribute("data-label", label);
      if (el.hasAttribute("aria-label")) el.setAttribute("aria-label", label);
      el.hidden = count === 0;
      if (el.classList.contains("map-country--link")) el.tabIndex = count === 0 ? -1 : 0;
    });
    var row = document.querySelector(".nordics");
    if (row) row.hidden = !row.querySelector(".nordic-hit:not([hidden])");
  }

  function countryFromMarketPill() {
    var keys = Object.keys(MARKET_COUNTRY);
    for (var i = 0; i < keys.length; i += 1) {
      if (!market && MARKET_COUNTRY[keys[i]] === country) return true;
    }
    return false;
  }

  function optionExists(sel, value) {
    return Array.prototype.some.call(sel.options, function (opt) { return opt.value === value; });
  }

  function syncSelects() {
    document.querySelectorAll('select[data-filter="market"]').forEach(function (sel) {
      var next = market || country || "";
      sel.value = optionExists(sel, next) ? next : "";
    });
    document.querySelectorAll('select[data-filter="sector"]').forEach(function (sel) {
      sel.value = optionExists(sel, sector) ? sector : "";
    });
  }

  function syncUi() {
    document.querySelectorAll("[data-country], [data-map-reset]").forEach(function (el) {
      var value = el.hasAttribute("data-map-reset") ? "" : (el.getAttribute("data-country") || "");
      el.setAttribute("aria-pressed", (country ? value === country : value === "") ? "true" : "false");
    });
    document.querySelectorAll('button[data-filter="market"]').forEach(function (peer) {
      var value = peer.getAttribute("data-value") || "";
      var pressed = false;
      if (!value) pressed = !market && !countryFromMarketPill();
      else if (market) pressed = market === value;
      else pressed = MARKET_COUNTRY[value] === country;
      peer.setAttribute("aria-pressed", pressed ? "true" : "false");
    });
    document.querySelectorAll('button[data-filter="sector"]').forEach(function (peer) {
      peer.setAttribute("aria-pressed", (peer.getAttribute("data-value") || "") === sector ? "true" : "false");
    });
    syncSelects();
  }

  function showTip(id, source) {
    if (!tip) return;
    var marker = source || document.querySelector('.nordic-hit[data-country="' + id + '"], .map-marker[data-country="' + id + '"]');
    var frame = document.querySelector(".map-frame");
    if (!marker || !frame) {
      tip.hidden = true;
      return;
    }
    var frameBox = frame.getBoundingClientRect();
    var box = marker.getBoundingClientRect();
    tip.hidden = false;
    tip.textContent = marker.getAttribute("data-label") || "";
    tip.style.left = (box.left - frameBox.left + box.width / 2) + "px";
    tip.style.top = (box.top - frameBox.top) + "px";
  }

  function applyMarket(value) {
    if (!value) {
      market = "";
      country = "";
    } else if (MARKET_COUNTRY[value]) {
      country = MARKET_COUNTRY[value];
      market = "";
    } else {
      market = value;
      country = "";
    }
  }

  function chooseCountry(id, scroll) {
    country = id || "";
    syncUi();
    apply();
    if (country) showTip(country);
    else if (tip) tip.hidden = true;
    if (scroll && country) {
      document.getElementById("startup-list").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    }
  }

  function layoutClamps() {
    var mobile = window.matchMedia("(max-width: 639px)").matches;
    document.querySelectorAll("[data-clamp]").forEach(function (row) {
      var more = document.querySelector('[data-expand="' + row.getAttribute("data-clamp") + '"]');
      if (!more) return;
      if (mobile) {
        more.hidden = true;
        return;
      }
      var open = row.classList.contains("is-open");
      row.classList.remove("is-open");
      var overflows = row.scrollHeight > row.clientHeight + 1;
      if (open && overflows) row.classList.add("is-open");
      more.hidden = !overflows;
      more.textContent = row.classList.contains("is-open") ? "Less" : "More";
      more.setAttribute("aria-expanded", row.classList.contains("is-open") ? "true" : "false");
    });
  }

  search.addEventListener("input", apply);
  document.querySelectorAll("button[data-filter]").forEach(function (button) {
    button.addEventListener("click", function () {
      var kind = button.getAttribute("data-filter");
      var value = button.getAttribute("data-value") || "";
      if (kind === "market") applyMarket(value);
      if (kind === "sector") sector = value;
      syncUi();
      apply();
      if (kind === "market" && country) showTip(country);
      else if (tip && !country) tip.hidden = true;
    });
  });
  document.querySelectorAll("select[data-filter]").forEach(function (sel) {
    sel.addEventListener("change", function () {
      var kind = sel.getAttribute("data-filter");
      var value = sel.value || "";
      if (kind === "market") applyMarket(value);
      if (kind === "sector") sector = value;
      syncUi();
      apply();
      if (kind === "market" && country) showTip(country);
      else if (tip && !country) tip.hidden = true;
    });
  });
  document.querySelectorAll("[data-expand]").forEach(function (button) {
    button.addEventListener("click", function () {
      var row = document.querySelector('[data-clamp="' + button.getAttribute("data-expand") + '"]');
      if (!row) return;
      row.classList.toggle("is-open");
      layoutClamps();
    });
  });
  window.addEventListener("resize", layoutClamps);
  window.addEventListener("load", layoutClamps);
  layoutClamps();
  document.querySelectorAll("[data-stage]").forEach(function (button) {
    button.addEventListener("click", function () {
      kind = button.getAttribute("data-stage") || "startup";
      document.querySelectorAll("[data-stage]").forEach(function (peer) {
        peer.setAttribute("aria-pressed", peer === button ? "true" : "false");
      });
      var list = document.getElementById("startup-list");
      if (list) {
        list.classList.toggle("is-startups", kind === "startup");
        list.classList.toggle("is-scale-ups", kind === "scale-up");
      }
      document.querySelectorAll('[aria-label="City"] a').forEach(function (link) {
        var href = (link.getAttribute("href") || "").split("#")[0];
        link.setAttribute("href", href === "/startups" || kind === "startup" ? href : href + "#scale-ups");
      });
      syncMap();
      apply();
      if (country) showTip(country);
      else if (tip) tip.hidden = true;
    });
  });
  syncMap();
  apply();

  document.querySelectorAll(".map-marker, .nordic-hit").forEach(function (marker) {
    marker.addEventListener("click", function () {
      chooseCountry(marker.getAttribute("data-country"), true);
      showTip(marker.getAttribute("data-country"), marker);
    });
    marker.addEventListener("pointerenter", function () { showTip(marker.getAttribute("data-country"), marker); });
    marker.addEventListener("focus", function () { showTip(marker.getAttribute("data-country"), marker); });
    marker.addEventListener("pointerleave", function () { if (country) showTip(country); else if (tip) tip.hidden = true; });
    marker.addEventListener("blur", function () { if (country) showTip(country); else if (tip) tip.hidden = true; });
  });
  document.querySelectorAll(".map-country--link").forEach(function (shape) {
    shape.addEventListener("click", function () {
      chooseCountry(shape.getAttribute("data-country"), true);
    });
    shape.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        chooseCountry(shape.getAttribute("data-country"), true);
      }
    });
    shape.addEventListener("pointerenter", function () { showTip(shape.getAttribute("data-country")); });
    shape.addEventListener("focus", function () { showTip(shape.getAttribute("data-country")); });
    shape.addEventListener("pointerleave", function () { if (country) showTip(country); else if (tip) tip.hidden = true; });
    shape.addEventListener("blur", function () { if (country) showTip(country); else if (tip) tip.hidden = true; });
  });
  var mapReset = document.querySelector("[data-map-reset]");
  if (mapReset) mapReset.addEventListener("click", function () { chooseCountry("", false); });
})();
</script>
</body>
</html>
`;
}

async function main() {
  const byCity = [];
  for (const city of CITIES) {
    const companies = await loadCity(city);
    companies.sort((a, b) => a.name.localeCompare(b.name));
    byCity.push({ ...city, companies });
  }
  const scaleUps = await loadScaleUps();
  scaleUps.sort((a, b) => a.name.localeCompare(b.name));
  const all = byCity.flatMap((city) => city.companies);
  for (const city of CITIES) {
    const scaleCount = scaleUps.filter((company) => company.slug === city.slug).length;
    const startupCount = byCity.find((item) => item.slug === city.slug).companies.length;
    console.log(`${city.label}: ${startupCount} startups, ${scaleCount} scale-ups`);
  }
  const topo = JSON.parse(await readFile(path.join(root, "startups/data/world/countries-110m.json"), "utf8"));
  const jsonPath = path.join(root, "startups/data/startups.json");
  await writeFile(jsonPath, `${JSON.stringify({ cities: CITIES.map(({ slug, label }) => ({ slug, label })), startups: all, scaleUps }, null, 2)}\n`);

  const pages = [
    { dir: path.join(root, "startups"), title: "GAIIN Startup Database", pathName: "/startups", heading: "GAIIN Startup Database", companies: all, scaleUps, activeSlug: "all", topo },
    ...byCity.map((city) => ({
      dir: path.join(root, "startups", city.slug),
      title: `${city.label} | GAIIN Startup Database`,
      pathName: `/startups/${city.slug}`,
      heading: city.label,
      companies: city.companies,
      scaleUps: scaleUps.filter((company) => company.slug === city.slug),
      activeSlug: city.slug,
      topo,
    })),
  ];
  for (const page of pages) {
    await mkdir(page.dir, { recursive: true });
    await writeFile(path.join(page.dir, "index.html"), pageHtml(page));
  }
  console.log(`wrote ${all.length} startups, ${scaleUps.length} scale-ups`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
