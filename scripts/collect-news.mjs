import { readFile, writeFile } from 'node:fs/promises';

const newsPath = new URL('../archive/daily/news.json', import.meta.url);
const dayMs = 86_400_000;
const cutoff = Date.now();
const firstDay = new Date(cutoff + dayMs / 3 - 7 * dayMs).toISOString().slice(0, 10);

function clean(value) {
  const entities = { amp: '&', apos: "'", quot: '"', nbsp: ' ' };
  return String(value ?? '').replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|apos|quot|nbsp);/gi, (match, code) => {
      if (!code.startsWith('#')) return entities[code.toLowerCase()] ?? match;
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }).replace(/\s+/g, ' ').trim();
}

function articleUrl(value, source) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    const nba = url.hostname === 'www.nba.com' && /^\/news\/[a-z0-9-]+\/?$/i.test(url.pathname);
    const espn = url.hostname === 'www.espn.com' && /^\/nba\/story\/_\/id\/\d+(?:\/[a-z0-9-]+)?\/?$/i.test(url.pathname);
    if (source === 'NBA.com' ? nba : espn) return url.origin + url.pathname.replace(/\/$/, '');
    return '';
  } catch {
    return '';
  }
}

function localDay(iso) {
  const time = Date.parse(iso);
  return new Date(time + dayMs / 3).toISOString().slice(0, 10);
}

function recent(iso) {
  const time = Date.parse(iso);
  return typeof iso === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(iso)
    && Number.isFinite(time) && time <= cutoff && localDay(iso) >= firstDay;
}

async function fetchPage(url, format = 'text') {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
  return response[format]();
}

function nbaPage(html) {
  const raw = html.match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  return raw ? JSON.parse(raw).props?.pageProps : null;
}

function labelFor(title) {
  if (/\binjur\w*|strain|sprain|sidelined|out of|concussion|surgery\b/i.test(title)) return '伤病动态';
  if (/\btrade[sd]?|waiv\w*|signs?|contract|re-sign\w*\b/i.test(title)) return '交易与签约报道';
  if (/\bwin[s]?|buzzer|overtime|triple.double|scor\w+\b/i.test(title)) return '赛场纪实';
  return 'NBA 动态';
}

function excluded(title) {
  return /\bfantasy|mock draft|power rankings|rumou?rs?|trade idea|could land|betting|odds|picks and predictions|streaming guide\b/i.test(title);
}

async function nbaFeed() {
  const page = nbaPage(await fetchPage('https://www.nba.com/news'));
  if (!Array.isArray(page?.latest?.items)) throw new Error('NBA news index format changed');
  return [...(page.features ?? []), ...page.latest.items]
    .map(item => ({ source: 'NBA.com', url: articleUrl(item.permalink, 'NBA.com'), time: item.date, title: item.title, id: item.id }));
}

async function espnFeed() {
  const listing = await fetchPage('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=30', 'json');
  if (!Array.isArray(listing.articles)) throw new Error('ESPN news index format changed');
  return listing.articles.filter(item => item.type === 'HeadlineNews')
    .map(item => ({ source: 'ESPN', url: articleUrl(item.links?.web?.href, 'ESPN'), time: item.published, title: item.headline }));
}

function extractEspnArticle(html) {
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const item = JSON.parse(match[1]);
      const records = item['@graph'] ?? [item];
      const article = records.find(record => /Article|NewsArticle|ReportageNewsArticle/.test(record['@type']) && record.headline && record.datePublished);
      if (article) return article;
    } catch {
      continue;
    }
  }
  return null;
}

async function verify(candidate) {
  const html = await fetchPage(candidate.url);
  let headline;
  let timestamp;
  let gameId;
  let excerpt;
  if (candidate.source === 'NBA.com') {
    const post = nbaPage(html)?.article;
    if (post?.id !== candidate.id || post?.status !== 'publish' || articleUrl(post.permalink, candidate.source) !== candidate.url) return null;
    headline = post.title;
    excerpt = post.excerpt;
    timestamp = post.date;
    const games = Object.keys(post.taxonomy?.games ?? {});
    if (games.length === 1 && /^\d{10}$/.test(games[0])) gameId = games[0];
  } else {
    const post = extractEspnArticle(html);
    if (!post) return null;
    headline = post.headline;
    excerpt = post.description;
    timestamp = post.datePublished;
  }
  if (!headline || !recent(timestamp) || excluded(headline)) return null;
  const title = clean(headline).split(' ').slice(0, 25).join(' ');
  const deck = clean(excerpt);
  const detail = deck && deck.split(' ').length + title.split(' ').length <= 25 ? deck : '';
  return { published: timestamp, url: candidate.url, title, detail, label: labelFor(title), source: candidate.source, ...(gameId ? { gameId } : {}) };
}

const existing = JSON.parse(await readFile(newsPath, 'utf8'));
const stories = new Map(existing.map(story => [story.url, story]));
const feeds = await Promise.allSettled([nbaFeed(), espnFeed()]);
const candidates = new Map();
for (const feed of feeds) {
  if (feed.status === 'rejected') { console.warn(feed.reason.message); continue; }
  for (const item of feed.value) {
    if (item.url && item.title && recent(item.time) && !excluded(item.title) && !stories.has(item.url)) candidates.set(item.url, item);
  }
}
let added = 0;
const entries = [...candidates.values()].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 28);
for (let index = 0; index < entries.length; index += 5) {
  const results = await Promise.allSettled(entries.slice(index, index + 5).map(verify));
  for (const result of results) {
    if (result.status === 'rejected') { console.warn(result.reason.message); continue; }
    if (!result.value) continue;
    stories.set(result.value.url, result.value);
    added += 1;
  }
}
const sorted = [...stories.values()].sort((a, b) => Date.parse(b.published) - Date.parse(a.published) || a.url.localeCompare(b.url));
console.log('NBA news: ' + feeds.filter(feed => feed.status === 'fulfilled').length + '/2 indexes, ' + added + ' newly verified articles.');
if (added && !process.argv.includes('--dry-run')) await writeFile(newsPath, JSON.stringify(sorted, null, 2) + '\n');
