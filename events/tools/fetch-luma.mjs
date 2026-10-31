#!/usr/bin/env node
/**
 * Pull upcoming Luma events for GAIIN founding hubs and write events/data/events.json.
 *
 * Usage, from the repo root:
 *   node events/tools/fetch-luma.mjs
 *
 * Add a city by appending one object to CITIES, then run this script again.
 * slug is the Luma place slug. hub is APAC or Europe.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CITIES = [
  { slug: "hongkong", city: "Hong Kong", hub: "APAC" },
  { slug: "stockholm", city: "Stockholm", hub: "Europe" },
  { slug: "copenhagen", city: "Copenhagen", hub: "Europe" },
  { slug: "oslo", city: "Oslo", hub: "Europe" },
];

const ENDPOINT = "https://api.luma.com/discover/get-paginated-events";
const PAGE_LIMIT = "20";
const MAX_PAGES = 20;

// Keep when the name, calendar, or a host matches. "tech" covers fintech, deep tech, hard tech.
const KEEP = [
  /(?:^|[^a-z0-9])ai(?:[^a-z]|$)/i,
  /machine\s+learning/i,
  /deep\s+learning/i,
  /(?:^|[^a-z0-9])ml(?:[^a-z0-9]|$)/i,
  /(?:^|[^a-z0-9])llm(?:[^a-z0-9]|$)/i,
  /gpt/i,
  /openai/i,
  /claude/i,
  /(?:^|[^a-z0-9])grok(?:[^a-z0-9]|$)/i,
  /hackathon/i,
  /buildathon/i,
  /\bdev(?:con|day|s|eloper|elopers)?\b/i,
  /software/i,
  /(?:^|[^a-z0-9])cloud(?:[^a-z0-9]|$)/i,
  /web3/i,
  /blockchain/i,
  /crypto/i,
  /stablecoin/i,
  /on-?chain/i,
  /ethereum/i,
  /(?:^|[^a-z0-9])defi(?:[^a-z0-9]|$)/i,
  /founder/i,
  /startup/i,
  /start\s+summit/i,
  /innovation/i,
  /climate/i,
  /sustainab/i,
  /robot/i,
  /\bdata/i,
  /tech/i,
  /(?:^|[^a-z0-9])cto(?:[^a-z0-9]|$)/i,
  /engineering/i,
  /(?:^|[^a-z0-9])science(?:[^a-z0-9]|$)/i,
  /(?:^|[^a-z0-9])intelligence(?:[^a-z0-9]|$)/i,
  /\bagents?\b/i,
  /microchip/i,
  /semiconductor/i,
  /\bpayments?\b/i,
  /digital\s+assets?/i,
  /\bsaas\b/i,
  /\bventure\b/i,
  /accelerator/i,
  /incubator/i,
  /\bcyber/i,
  /quantum/i,
  /open[\s-]?source/i,
  /人工智能/,
  /机器人|機器人/,
  /科技/,
  /創業|创业/,
  /創新|创新/,
  /金融科技/,
  /數據|数据/,
];

// Clear nightlife, sports, and unrelated social. A match on the event name drops it.
const DROP_NAME = [
  /happy\s*hours?/i,
  /\bparty\b/i,
  /\braves?\b/i,
  /\bpics?nic\b/i,
  /halloween/i,
  /\bmingle\b/i,
  /book\s*club/i,
  /movie\s*night/i,
  /run\s*club/i,
  /\bquiz\b/i,
  /vernissage/i,
  /date\s*games?/i,
  /\bxmas\b/i,
  /christmas/i,
  /karaoke/i,
  /\byoga\b/i,
  /\bmarathon\b/i,
  /\bfootball\b/i,
  /\bsoccer\b/i,
  /\btennis\b/i,
  /wine\s*tasting/i,
  /(?:^|[^a-z0-9])dj(?:[^a-z0-9]|$)/i,
  /nightclub/i,
  /\bconcert\b/i,
  /after[\s-]?work/i,
  /\bsocial\b/i,
  /\bhike\b/i,
  /\bhiking\b/i,
  /pub\s*crawl/i,
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outFile = path.join(root, "events/data/events.json");

function hits(text, patterns) {
  return patterns.some((re) => re.test(text));
}

function relevant(name, calendar, hosts) {
  if (hits(name, DROP_NAME)) return false;
  const hay = [name, calendar, ...hosts].filter(Boolean).join("\n");
  return hits(hay, KEEP);
}

function canonicalUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const absolute = /^https?:\/\//i.test(value)
    ? value
    : `https://luma.com/${value.replace(/^\//, "")}`;
  let parsed;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !/(^|\.)luma\.com$/i.test(parsed.hostname)) return null;
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return `https://luma.com${pathname}`;
}

function venueOf(event) {
  const loc = String(event.location_type || "").toLowerCase();
  const geo = event.geo_address_info || {};
  const cityText = String(geo.city_state || geo.city || "").trim();
  const online = loc === "online" || loc === "virtual" || loc === "zoom" || loc === "meet";
  if (online) return "Online";
  if (cityText) return cityText;
  return "Online";
}

function coverUrlOf(event) {
  const raw = String(event.cover_url || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || !/(^|\.)lumacdn\.com$/i.test(parsed.hostname)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function toEvent(entry, city) {
  const event = entry.event || {};
  const name = String(event.name || "").trim();
  const start = event.start_at;
  const startMs = Date.parse(start);
  if (!name || !start || Number.isNaN(startMs)) return { drop: "invalid" };
  if (startMs <= Date.now()) return { drop: "past" };
  const hosts = (Array.isArray(entry.hosts) ? entry.hosts : [])
    .map((host) => String(host?.name || "").trim())
    .filter(Boolean);
  const calendar = String(entry.calendar?.name || "").trim();
  if (!relevant(name, calendar, hosts)) return { drop: "filter", name };
  const url = canonicalUrl(event.url);
  if (!url) return { drop: "invalid" };
  const ticket = entry.ticket_info || {};
  return {
    event: {
      city: city.city,
      hub: city.hub,
      name,
      url,
      start,
      timezone: event.timezone || "UTC",
      venue: venueOf(event),
      cover_url: coverUrlOf(event),
      calendar: calendar || null,
      hosts,
      is_free: Boolean(ticket.is_free),
      is_sold_out: Boolean(ticket.is_sold_out),
      require_approval: Boolean(ticket.require_approval),
    },
  };
}

async function fetchPlace(slug) {
  const entries = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(ENDPOINT);
    url.searchParams.set("slug", slug);
    url.searchParams.set("pagination_limit", PAGE_LIMIT);
    if (cursor) url.searchParams.set("pagination_cursor", cursor);
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "gaiin-events-fetch/1.0 (+https://www.gaiin.xyz/events)",
      },
    });
    if (!res.ok) {
      throw new Error(`Luma ${slug} page ${page + 1} returned ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data.entries)) {
      throw new Error(`Luma ${slug} page ${page + 1} had no entries array`);
    }
    entries.push(...data.entries);
    if (!data.has_more) return entries;
    if (!data.next_cursor || data.next_cursor === cursor) {
      throw new Error(`Luma ${slug} reported more pages without a new cursor`);
    }
    cursor = data.next_cursor;
  }
  throw new Error(`Luma ${slug} exceeded ${MAX_PAGES} pages`);
}

async function main() {
  const seen = new Set();
  const events = [];
  const summary = [];

  for (const city of CITIES) {
    const entries = await fetchPlace(city.slug);
    const counts = { fetched: entries.length, past: 0, filter: 0, invalid: 0, dup: 0, kept: 0 };
    const kept = [];
    const dropped = [];
    for (const entry of entries) {
      const result = toEvent(entry, city);
      if (result.drop) {
        counts[result.drop] += 1;
        if (result.name) dropped.push(result.name);
        continue;
      }
      if (seen.has(result.event.url)) {
        counts.dup += 1;
        continue;
      }
      seen.add(result.event.url);
      counts.kept += 1;
      kept.push(result.event);
    }
    kept.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
    events.push(...kept);
    summary.push({ city: city.city, slug: city.slug, ...counts });
    console.log(
      `${city.city}: fetched ${counts.fetched}, kept ${counts.kept}, past ${counts.past}, filtered ${counts.filter}, dup ${counts.dup}`,
    );
    for (const name of kept.map((item) => item.name)) console.log(`  keep  ${name}`);
    for (const name of dropped) console.log(`  drop  ${name}`);
  }

  const payload = {
    fetched_at: new Date().toISOString(),
    events,
  };
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`wrote ${path.relative(root, outFile)} (${events.length} events)`);
  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
