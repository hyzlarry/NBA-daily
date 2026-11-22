import { readFile, rename, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const firstDate = '2026-10-01';
const lastDate = '2027-06-30';
const dayMs = 86_400_000;
const archive = new URL('../archive/daily/data.js', import.meta.url);
const season = new URL('../archive/daily/season-fixtures.js', import.meta.url);
const beijing = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const teamNames = new Map(Object.entries({
  ATL: '老鹰', BOS: '凯尔特人', BKN: '篮网', CHA: '黄蜂', CHI: '公牛',
  CLE: '骑士', DAL: '独行侠', DEN: '掘金', DET: '活塞', GSW: '勇士',
  HOU: '火箭', IND: '步行者', LAC: '快船', LAL: '湖人', MEM: '灰熊',
  MIA: '热火', MIL: '雄鹿', MIN: '森林狼', NOP: '鹈鹕', NYK: '尼克斯',
  OKC: '雷霆', ORL: '魔术', PHI: '76 人', PHX: '太阳', POR: '开拓者',
  SAC: '国王', SAS: '马刺', TOR: '猛龙', UTA: '爵士', WAS: '奇才'
}));

function beijingTipoff(timestamp) {
  const parts = Object.fromEntries(beijing.formatToParts(new Date(timestamp))
    .map(({ type, value }) => [type, value]));
  return { date: [parts.year, parts.month, parts.day].join('-'), time: parts.hour + ':' + parts.minute };
}

function shiftDate(date, offset) {
  return new Date(Date.parse(date) + dayMs * offset).toISOString().slice(0, 10);
}

function parseSchedule(html, date) {
  const json = html.match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!json) throw new Error(date + ' NBA schedule data not found');
  const page = JSON.parse(json).props?.pageProps;
  const modules = page?.gameCardFeed?.modules;
  const expected = page?.allGamesInCurrentYear?.[date.slice(0, 4)]?.[date];
  if (page?.selectedDate !== date || page.hasError || !Array.isArray(modules) || !Number.isInteger(expected)) {
    throw new Error(date + ' invalid NBA schedule or mismatched selected date');
  }
  const games = modules.flatMap(module => module.cards ?? [])
    .map(card => card.cardData)
    .filter(card => card?.gameId && card.leagueId === '00');
  if (games.length !== expected || new Set(games.map(game => game.gameId)).size !== expected) {
    throw new Error(date + ' NBA game count differs between calendar and match cards');
  }
  return games;
}

async function fetchSchedule(date) {
  const url = 'https://www.nba.com/games?date=' + date;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(date + ' NBA schedule returned HTTP ' + response.status);
  return parseSchedule(await response.text(), date);
}

function gameType(card, existing) {
  if (existing?.type) return existing.type;
  if (card.gameId.startsWith('001')) return '季前赛';
  if (card.gameId.startsWith('004')) return '季后赛';
  if (card.gameId.startsWith('005')) return '附加赛';
  if (card.gameId.startsWith('006')) return 'NBA 杯决赛';
  const number = Number(card.gameId.slice(5));
  return number >= 15 && number <= 74 ? 'NBA 杯小组赛' : '常规赛';
}

function recordGame(card, time, existing) {
  const { gameId: id, gameStatus, homeTeam, awayTeam, gameStatusText } = card;
  const home = teamNames.get(homeTeam?.teamTricode) ?? homeTeam?.teamName;
  const away = teamNames.get(awayTeam?.teamTricode) ?? awayTeam?.teamName;
  if (!/^\d{10}$/.test(id) || !home || !away || ![1, 2, 3].includes(gameStatus)) throw new Error('Invalid NBA game ' + id);
  if (existing?.status === '完赛' && gameStatus !== 3) throw new Error('Official status regressed for ' + id);
  const status = /postponed|cancelled|canceled/i.test(gameStatusText)
    ? (/postponed/i.test(gameStatusText) ? '已延期' : '已取消')
    : ['未开赛', '进行中', '完赛'][gameStatus - 1];
  const row = { id, time, type: gameType(card, existing), status, away, home };
  if (status !== '完赛') return row;
  if (![awayTeam.score, homeTeam.score].every(score => Number.isInteger(score) && score > 0)
      || awayTeam.score === homeTeam.score) throw new Error('Invalid final score for ' + id);
  row.as = awayTeam.score;
  row.hs = homeTeam.score;
  const players = [awayTeam, homeTeam].flatMap(team => {
    const leader = team.teamLeader;
    const points = Number(leader?.points);
    return leader?.name && leader.points !== '' && Number.isInteger(points) && points >= 0
      ? [[leader.name, points]] : [];
  });
  if (players.length || existing?.players) row.players = players.length ? players : existing.players;
  return row;
}

function serialize({ cutoff, games, moves, highlights }) {
  const lines = Object.entries(games).sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => '    ' + JSON.stringify(date) + ': ' + JSON.stringify(rows));
  return 'const nbaArchiveData = {\n  cutoff: ' + JSON.stringify(cutoff)
    + ',\n  games: {\n' + lines.join(',\n') + '\n  },\n  moves: ' + JSON.stringify(moves, null, 2)
    + ',\n  highlights: ' + JSON.stringify(highlights, null, 2).replaceAll('\n', '\n  ') + '\n};\n';
}

async function main() {
  const args = process.argv.slice(2);
  const dateArgument = args.find(arg => arg.startsWith('--date='))?.slice(7);
  const fixtureDir = args.find(arg => arg.startsWith('--fixtures='))?.slice(11);
  const dryRun = args.includes('--dry-run');
  if (fixtureDir && !dryRun) throw new Error('Saved source fixtures can only be used with --dry-run');
  const today = beijingTipoff(Date.now()).date;
  if (dateArgument && (!/^\d{4}-\d{2}-\d{2}$/.test(dateArgument) || shiftDate(dateArgument, 0) !== dateArgument
      || dateArgument < firstDate || dateArgument > lastDate)) throw new Error('Invalid archive date');
  if (!dateArgument && (today < firstDate || today > lastDate)) {
    console.log('No updates outside the 2026–27 archive.');
    return;
  }
  const from = dateArgument ?? [shiftDate(today, -6), firstDate].sort().at(-1);
  const through = dateArgument ?? [shiftDate(today, 3), lastDate].sort()[0];
  const sourceDates = [];
  for (let date = shiftDate(from, -1); date <= through; date = shiftDate(date, 1)) sourceDates.push(date);
  const results = await Promise.all(sourceDates.map(async date => {
    if (!fixtureDir) return fetchSchedule(date);
    return parseSchedule(await readFile(fixtureDir + '/nba-sample-' + date + '.html', 'utf8'), date);
  }));
  const original = await readFile(archive, 'utf8');
  const data = runInNewContext(original + '\n nbaArchiveData');
  const fixtures = runInNewContext(await readFile(season, 'utf8') + '\n nbaSeasonFixtures');
  const merged = new Map();
  for (const [date, rows] of Object.entries(data.games)) {
    for (const row of rows) merged.set(row.id, { date, row });
  }
  for (let date = from; date <= through; date = shiftDate(date, 1)) {
    for (const [id, time, away, home, type = '常规赛'] of fixtures[date] ?? []) {
      if (!merged.has(id)) merged.set(id, { date, row: { id, time, type, status: '未开赛', away, home } });
    }
  }
  let verified = 0;
  const seen = new Set();
  for (const card of results.flat()) {
    if (card.seasonYear !== '2026-27' || !card.gameTimeUtc?.endsWith('Z')) throw new Error('Unexpected NBA season or tipoff for ' + card.gameId);
    const { date, time } = beijingTipoff(card.gameTimeUtc);
    if (date < from || date > through) continue;
    if (seen.has(card.gameId)) throw new Error('Duplicate NBA game ' + card.gameId);
    seen.add(card.gameId);
    const previous = merged.get(card.gameId)?.row;
    merged.set(card.gameId, { date, row: recordGame(card, time, previous) });
    verified += 1;
  }

  const games = Object.fromEntries(Object.keys(data.games).map(date => [date, []]));
  for (const { date, row } of merged.values()) (games[date] ??= []).push(row);
  for (const rows of Object.values(games)) rows.sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  const checkedThrough = [today, through].sort()[0];
  const cutoff = checkedThrough > data.cutoff ? checkedThrough : data.cutoff;
  const unchanged = JSON.stringify(games) === JSON.stringify(data.games) && cutoff === data.cutoff;
  console.log('Verified ' + verified + ' official games for ' + from + ' through ' + through + (dryRun ? ' (dry run)' : ''));
  if (unchanged || dryRun) return;
  const temporary = new URL('../archive/daily/data.js.tmp', import.meta.url);
  await writeFile(temporary, serialize({ ...data, cutoff, games }));
  await rename(temporary, archive);
}

await main();
