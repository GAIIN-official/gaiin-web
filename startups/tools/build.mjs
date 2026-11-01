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

function loadCity(city) {
  const text = awaitRead(path.join(sourceDir, city.file));
  return text.then((raw) => {
    const records = parseCsv(raw);
    return records.map((row) => {
      const name = row.name.trim();
      if (!name) throw new Error(`${city.file}: a row has no name`);
      if (BANNED.some((banned) => name.toLowerCase().includes(banned))) {
        throw new Error(`${name} must not appear on a city page`);
      }
      if (row.fact_check_status.trim() !== "PASS") {
        throw new Error(`${name}: fact_check_status is not PASS`);
      }
      const founders = splitList(row.founders, ",");
      const markets = marketsOf(row.operating_markets);
      const sectors = splitList(row.sector, ";");
      return {
        name,
        slug: city.slug,
        city: city.label,
        logo: row.logo.trim(),
        initials: initials(name),
        short_description: row.short_description.trim(),
        founders,
        hq_city: row.hq_city.trim(),
        operating_markets: markets,
        website: row.website.trim(),
        sectors,
        last_verified: formatVerified(row.last_verified.trim(), name),
        valuation: valuationOf(row),
      };
    });
  });
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
  .list { display: flex; flex-direction: column; gap: 12px; }
  .startup-card { display: grid; grid-template-columns: 168.75px minmax(0, 1fr); column-gap: 18px; align-items: center; padding: 16px; background: #0d2951; border: 1px solid #1c2f52; border-radius: 16px; }
  .startup-card[hidden] { display: none; }
  .startup-card__media { position: relative; width: 168.75px; height: 168.75px; border-radius: 14px; overflow: hidden; flex-shrink: 0; }
  .startup-card__media--light { background: #f7f9fb; }
  .startup-card__media--navy { background: #0a1730; }
  .startup-card__media img, .logo-fallback { position: absolute; inset: 0; width: 100%; height: 100%; }
  .startup-card__media img { object-fit: contain; display: block; padding: 14px; }
  .logo-fallback { display: flex; align-items: center; justify-content: center; font-family: 'Fragment Mono', monospace; font-size: 28px; letter-spacing: .08em; }
  .startup-card__media--light .logo-fallback { color: #0a1730; }
  .startup-card__media--navy .logo-fallback { color: #EDB3A8; }
  .startup-card__body { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
  .startup-card__sector { font-family: 'Fragment Mono', monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #EDB3A8; }
  .startup-card__name { font-size: clamp(22px,2vw,28px); line-height: 1.15; color: #f7f9fb; }
  .startup-card__desc { font-size: 15px; line-height: 1.6; color: #a8bcd8; }
  .startup-card__meta { font-size: 14px; line-height: 1.5; color: #8ea5c4; }
  .market-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .market-chip { font-family: 'Fragment Mono', monospace; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #EDB3A8; border: 1px solid #EDB3A8; border-radius: 999px; padding: 4px 10px; }
  .startup-card__value a { color: #d9877c; border-bottom: 1px solid #d9877c; font-family: 'Fragment Mono', monospace; font-size: 12px; }
  .startup-card__value a:hover { color: #EDB3A8; border-color: #EDB3A8; }
  .link-under { font-family: 'Fragment Mono', monospace; font-size: 12px; letter-spacing: .06em; color: #d9877c; border-bottom: 1px solid #d9877c; }
  .link-under:hover { color: #EDB3A8; border-color: #EDB3A8; }
  .startup-card__verified { font-family: 'Fragment Mono', monospace; font-size: 11px; letter-spacing: .06em; color: #8ea5c4; }
  .empty { font-size: 15px; line-height: 1.7; color: #a8bcd8; }
  .empty[hidden] { display: none; }
  @media (max-width: 720px) {
    .startup-card { grid-template-columns: 116px minmax(0, 1fr); column-gap: 15px; align-items: start; padding: 12px; }
    .startup-card__media { width: 116px; height: 116px; border-radius: 12px; }
    .startup-card__name { font-size: 18px; }
    .logo-fallback { font-size: 20px; }
  }
`;

function mediaClass(logo) {
  if (!logo || /white|_light\.|-light\.|syre_light/i.test(logo)) {
    return "startup-card__media startup-card__media--navy";
  }
  return "startup-card__media startup-card__media--light";
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
  const logo = company.logo
    ? `<img src="${esc(company.logo)}" alt="" width="400" height="400" loading="lazy" data-initials="${esc(company.initials)}">`
    : `<span class="logo-fallback">${esc(company.initials)}</span>`;
  const founders = company.founders.length
    ? `<p class="startup-card__meta">Founders: ${esc(company.founders.join(", "))}</p>`
    : "";
  const markets = company.operating_markets.map((market) => `<span class="market-chip">${esc(market)}</span>`).join("");
  const valuation = company.valuation
    ? `<p class="startup-card__value"><a href="${esc(company.valuation.source)}" target="_blank" rel="noopener noreferrer">${esc(company.valuation.text)}</a></p>`
    : "";
  const website = company.website
    ? `<a class="link-under" href="${esc(company.website)}" target="_blank" rel="noopener noreferrer">Website</a>`
    : "";
  return `<article class="startup-card" data-search="${esc(search)}" data-markets="${esc(company.operating_markets.join("|"))}" data-sectors="${esc(company.sectors.join("|"))}">
    <div class="${mediaClass(company.logo)}">${logo}</div>
    <div class="startup-card__body">
      <p class="startup-card__sector">${esc(company.sectors.join(" · "))}</p>
      <h2 class="startup-card__name">${esc(company.name)}</h2>
      <p class="startup-card__desc">${esc(company.short_description)}</p>
      ${founders}
      <p class="startup-card__meta">HQ: ${esc(company.hq_city)}</p>
      <div class="market-chips">${markets}</div>
      ${valuation}
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

function pageHtml({ title, pathName, heading, companies, activeSlug }) {
  const markets = unique(companies.flatMap((company) => company.operating_markets)).sort((a, b) => a.localeCompare(b));
  const sectors = SECTOR_ORDER.filter((sector) => companies.some((company) => company.sectors.includes(sector)));
  const cityLinks = [
    chipLink("/startups", "All", true, activeSlug === "all"),
    ...CITIES.map((city) => chipLink(`/startups/${city.slug}`, city.label, false, activeSlug === city.slug)),
  ].join("");
  const marketButtons = [chipButton("All", "market", "", true), ...markets.map((market) => chipButton(market, "market", market, false))].join("");
  const sectorButtons = [chipButton("All", "sector", "", true), ...sectors.map((sector) => chipButton(sector, "sector", sector, false))].join("");
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
<section style="background:#0a1730;">
  <div class="wrap">
    <form class="search" role="search" onsubmit="return false">
      <label class="visually-hidden" for="startup-search" style="position:absolute;width:1px;height:1px;overflow:hidden;">Search startups</label>
      <input id="startup-search" type="search" placeholder="Search name, founder, or market" autocomplete="off">
    </form>
    <div class="filters">
      <div class="filters__row" role="navigation" aria-label="City">${cityLinks}</div>
      <div class="filters__row" role="group" aria-label="Operating market">${marketButtons}</div>
      <div class="filters__row" role="group" aria-label="Sector">${sectorButtons}</div>
    </div>
    <div class="list" id="startup-list">
      ${companies.map(cardHtml).join("\n")}
    </div>
    <p class="empty" id="startup-empty" hidden>No matching startups.</p>
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
      var ok = (!query || (card.getAttribute("data-search") || "").indexOf(query) !== -1)
        && (!market || markets.indexOf(market) !== -1)
        && (!sector || sectors.indexOf(sector) !== -1);
      card.hidden = !ok;
      if (ok) shown += 1;
    });
    empty.hidden = shown !== 0;
  }

  search.addEventListener("input", apply);
  document.querySelectorAll("[data-filter]").forEach(function (button) {
    button.addEventListener("click", function () {
      var kind = button.getAttribute("data-filter");
      var value = button.getAttribute("data-value") || "";
      if (kind === "market") market = value;
      if (kind === "sector") sector = value;
      document.querySelectorAll('[data-filter="' + kind + '"]').forEach(function (peer) {
        peer.setAttribute("aria-pressed", peer === button ? "true" : "false");
      });
      apply();
    });
  });
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
    console.log(`${city.label}: ${companies.length}`);
  }
  const all = byCity.flatMap((city) => city.companies);
  const jsonPath = path.join(root, "startups/data/startups.json");
  await writeFile(jsonPath, `${JSON.stringify({ cities: CITIES.map(({ slug, label }) => ({ slug, label })), startups: all }, null, 2)}\n`);

  const pages = [
    { dir: path.join(root, "startups"), title: "GAIIN Startup Database", pathName: "/startups", heading: "GAIIN Startup Database", companies: all, activeSlug: "all" },
    ...byCity.map((city) => ({
      dir: path.join(root, "startups", city.slug),
      title: `${city.label} | GAIIN Startup Database`,
      pathName: `/startups/${city.slug}`,
      heading: city.label,
      companies: city.companies,
      activeSlug: city.slug,
    })),
  ];
  for (const page of pages) {
    await mkdir(page.dir, { recursive: true });
    await writeFile(path.join(page.dir, "index.html"), pageHtml(page));
  }
  console.log(`wrote ${all.length} startups`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
