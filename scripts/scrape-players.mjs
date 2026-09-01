/**
 * Scraper one-time de fichas de jugadores de fantacalcio.it → data/players.json
 * Uso: node scripts/scrape-players.mjs
 * Reanudable: los ids ya presentes en players.json se saltean.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'data', 'players.json');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const TEAMS = [
  'atalanta', 'bologna', 'cagliari', 'como', 'fiorentina', 'frosinone', 'genoa',
  'inter', 'juventus', 'lazio', 'lecce', 'milan', 'monza', 'napoli', 'parma',
  'roma', 'sassuolo', 'torino', 'udinese', 'venezia',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (res.ok) return await res.text();
      console.error(`  HTTP ${res.status} en ${url}`);
    } catch (err) {
      console.error(`  error de red en ${url}: ${err.message}`);
    }
    await sleep(2000 * (i + 1));
  }
  return null;
}

// ids del listone (columna 7), salteando headers
const listoneIds = new Set(
  readFileSync(join(root, 'data', 'listone-classic.csv'), 'utf8')
    .split('\n')
    .map((l) => l.split(',')[6])
    .filter((v) => /^\d+$/.test(v ?? ''))
    .map(Number),
);

const db = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};

function pick(re, html) {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function num(v) {
  if (v == null) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseProfile(html, url) {
  const stats = html.match(/class="player-stats"[\s\S]{0,3000}/)?.[0] ?? '';
  const statVal = (title) =>
    pick(new RegExp(`title="${title}[^"]*">\\s*<span[^>]*>([^<]+)<`), stats);
  return {
    url,
    height: pick(/itemprop="height">([^<]+)</, html),
    birthDate: pick(/class="birthdate">([^<]+)</, html),
    foot: pick(/<dt>Piede<\/dt>[\s\S]{0,120}?<span title="([^"]+)"/, html),
    nationality: pick(/class="nationalities">([^<]+)</, html),
    mv: num(statVal('Media Voto')),
    fm: num(statVal('Fantamedia')),
    fvm: num(statVal('FantaValore di Mercato \\(Classic\\)')),
    description:
      pick(/<div class="description">\s*([\s\S]*?)<\/div>/, html)
        ?.replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim() || null,
  };
}

const urls = new Map(); // id -> profile url
for (const team of TEAMS) {
  const html = await get(`https://www.fantacalcio.it/serie-a/squadre/${team}`);
  if (!html) continue;
  for (const m of html.matchAll(
    /href="(https:\/\/www\.fantacalcio\.it\/serie-a\/squadre\/[a-z0-9-]+\/[a-z0-9-]+\/(\d+))"/g,
  )) {
    urls.set(Number(m[2]), m[1]);
  }
  console.log(`${team}: ${urls.size} urls acumuladas`);
  await sleep(500);
}

const pending = [...listoneIds].filter((id) => !db[id] && urls.has(id));
const missing = [...listoneIds].filter((id) => !urls.has(id));
console.log(`\nfichas a scrapear: ${pending.length} | sin url (quedan solo con card): ${missing.length}\n`);

let done = 0;
for (const id of pending) {
  const html = await get(urls.get(id));
  if (html) {
    db[id] = parseProfile(html, urls.get(id));
    done++;
    if (done % 25 === 0) {
      writeFileSync(OUT, JSON.stringify(db, null, 1));
      console.log(`  ${done}/${pending.length} (guardado parcial)`);
    }
  }
  await sleep(600);
}

writeFileSync(OUT, JSON.stringify(db, null, 1));
console.log(`\n✅ players.json: ${Object.keys(db).length} fichas (${missing.length} ids del listone sin ficha)`);
