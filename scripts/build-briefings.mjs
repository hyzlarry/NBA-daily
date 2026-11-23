import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const archive = new URL('../archive/daily/', import.meta.url);
async function readData(file, binding) {
  const source = await readFile(new URL(file, archive), 'utf8');
  return runInNewContext(source + '\n' + binding);
}
const { cutoff, games, moves, highlights } = await readData('data.js', 'nbaArchiveData');
const fixtures = await readData('season-fixtures.js', 'nbaSeasonFixtures');
const archiveIds = new Set(Object.values(games).flatMap(rows => rows.map(row => row.id)));
const dayMs = 86_400_000;
const firstDay = Date.parse('2026-10-01');
const lastDay = Date.parse('2027-06-30');

function margin(game) {
  return Math.abs(game.as - game.hs);
}

function highScorer(game) {
  return (game.players ?? []).reduce((highest, player) => player[1] > (highest?.[1] ?? 0) ? player : highest, null);
}

function recap(game) {
  const awayWon = game.as > game.hs;
  const winner = awayWon ? game.away : game.home;
  const loser = awayWon ? game.home : game.away;
  const score = [Math.max(game.as, game.hs), Math.min(game.as, game.hs)].join(' 比 ');
  const verb = margin(game) <= 3 ? '险胜' : '击败';
  const leader = highScorer(game);
  const detail = leader ? leader[0] + '拿到 ' + leader[1] + ' 分。' : '完赛比分已由 NBA 比赛中心确认。';
  return {
    id: game.id, time: game.time, label: game.type + ' · 完赛',
    title: winner + ' ' + score + ' ' + verb + loser, detail
  };
}

function makeBrief(date) {
  const scheduled = (fixtures[date] ?? []).filter(([id]) => !archiveIds.has(id))
    .map(([id, time, away, home, type = '常规赛']) => ({ id, time, away, home, type, status: '未开赛' }));
  const rows = games[date] ?? scheduled;
  const results = rows.filter(game => game.status === '完赛');
  const upcoming = rows.filter(game => game.status === '未开赛');
  const other = rows.length - results.length - upcoming.length;
  const teamNews = (moves[date] ?? []).slice(0, 8).map(([title, detail, url]) => ({ title, detail, url, label: '球队官宣' }));
  const totals = [];
  if (results.length) totals.push(results.length + ' 场完赛');
  if (upcoming.length) totals.push(upcoming.length + ' 场待赛');
  if (other) totals.push(other + ' 场状态见赛程');
  if (moves[date]?.length) totals.push(moves[date].length + ' 条球队官宣');
  const summary = totals.length ? '当日已核对：' + totals.join('、') + '。' : '';
  if (!results.length) {
    const entries = upcoming.slice(0, Math.min(3, 8 - teamNews.length)).map(game => ({
      id: game.id, time: game.time, label: game.type + ' · 待赛',
      title: game.away + ' 对 ' + game.home, detail: ''
    }));
    return { summary, entries: [...entries, ...teamNews] };
  }
  const standout = [...results].sort((a, b) => (highScorer(b)?.[1] ?? 0) - (highScorer(a)?.[1] ?? 0))[0];
  const tightest = [...results].sort((a, b) => margin(a) - margin(b))[0];
  const selection = [...new Set([tightest, standout, ...results])].slice(0, 8 - teamNews.length);
  const entries = selection.sort((a, b) => a.time.localeCompare(b.time)).map(recap);
  return { summary, entries: [...entries, ...teamNews] };
}

const published = new Date().toISOString();
const days = {};
for (let tick = firstDay; tick <= lastDay; tick += dayMs) {
  const date = new Date(tick).toISOString().slice(0, 10);
  days[date] = makeBrief(date);
}
const data = { published, cutoff, days };
await writeFile(new URL('briefings.js', archive), 'const nbaDailyBriefings = ' + JSON.stringify(data) + ';\n');
console.log('Generated ' + Object.keys(days).length + ' daily briefings, with verified results through ' + cutoff + '.');

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => entities[character]);
}

function renderStory(story) {
  const type = story.id ? 'game' : 'move';
  const matchLink = story.id ? 'https://www.nba.com/game/' + story.id : story.url;
  const sourceLabel = story.id ? 'NBA 比赛中心' : '球队官方公告';
  const official = '<a href="' + escapeHtml(matchLink) + '">' + sourceLabel + '</a>';
  const video = highlights[story.id];
  const videoLink = video ? '<a class="video-link" href="' + escapeHtml(video) + '">腾讯体育全场集锦</a>' : '';
  const time = story.time ? '<time datetime="' + cutoff + 'T' + escapeHtml(story.time) + ':00+08:00">' + escapeHtml(story.time) + '</time>' : '';
  const detail = story.detail ? '<p>' + escapeHtml(story.detail) + '</p>' : '';
  return [
    '      <article class="story" data-kind="' + type + '">',
    '        <div class="meta">' + time + '<span>' + escapeHtml(story.label) + '</span></div>',
    '        <h2>' + escapeHtml(story.title) + '</h2>',
    '        ' + detail,
    '        <div class="links">' + official + videoLink + '</div>',
    '      </article>'
  ].join('\n');
}

function renderLatestBrief(brief) {
  const summary = brief.summary || 'NBA 官方赛程显示当天没有比赛。';
  const dayUrl = './archive/daily/index.html?date=' + cutoff + '#daily-brief';
  const lines = [
    '  <section id="latest-brief" aria-labelledby="brief-title">',
    '    <div class="mast">',
    '      <h1 id="brief-title">NBA 每日简报</h1>',
    '      <p class="issue">本期 · 北京时间 <time datetime="' + cutoff + '">' + cutoff.replaceAll('-', '.') + '</time></p>',
    '    </div>',
    '    <div class="overview"><p>' + escapeHtml(summary) + '</p><a href="' + dayUrl + '">查看当日完整归档</a></div>'
  ];
  if (brief.entries.some(story => story.id) && brief.entries.some(story => story.url)) {
    lines.push('    <div class="filters" role="group" aria-label="筛选简报" hidden>',
      '      <button type="button" data-filter="all" aria-pressed="true">全部</button>',
      '      <button type="button" data-filter="game" aria-pressed="false">比赛</button>',
      '      <button type="button" data-filter="move" aria-pressed="false">球队官宣</button>',
      '    </div>');
  }
  if (brief.entries.length) lines.push('    <div class="grid">', ...brief.entries.map(renderStory), '    </div>');
  lines.push('  </section>');
  return lines.join('\n');
}

const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const briefSection = /<!-- latest-brief:start -->[\s\S]*?<!-- latest-brief:end -->/;
if (!briefSection.test(template) || !days[cutoff]) throw new Error('Missing homepage template or current briefing.');
const homepage = template
  .replace(briefSection, () => renderLatestBrief(days[cutoff]))
  .replace('name="date" type="date"', 'name="date" type="date" value="' + cutoff + '"');
const output = new URL('../_site/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('index.html', output), homepage);
console.log('Rendered latest briefing on homepage for ' + cutoff + '.');
