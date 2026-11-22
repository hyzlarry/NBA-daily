const { cutoff, games, moves, highlights } = nbaArchiveData;
const dates = Object.keys(games);
const main = document.querySelector('#content');

function el(tag, label, className) {
  const node = document.createElement(tag);
  if (label) node.textContent = label;
  if (className) node.className = className;
  return node;
}

function link(url, label, className) {
  const node = el('a', label, className);
  node.href = url;
  return node;
}

function dateLabel(date) {
  const [year, month, day] = date.split('-').map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

function dateUrl(date) {
  return `./index.html?date=${date}`;
}

function monthCalendar(month) {
  const section = el('section', '', 'month');
  section.id = month;
  const monthNumber = Number(month.slice(5));
  const heading = el('h2', `2026 年 ${monthNumber} 月`);
  heading.id = `month-${monthNumber}`;
  section.setAttribute('aria-labelledby', heading.id);
  section.append(heading, link(`../${month}/index.html`, '阅读本月月报'));

  const calendar = el('div', '', 'calendar');
  for (const weekday of ['一', '二', '三', '四', '五', '六', '日']) {
    calendar.append(el('span', weekday, 'weekday'));
  }
  const firstDay = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  for (let blank = 0; blank < (firstDay + 6) % 7; blank++) {
    const spacer = el('span');
    spacer.setAttribute('aria-hidden', 'true');
    calendar.append(spacer);
  }
  for (const date of dates.filter(value => value.startsWith(month))) {
    const scheduled = date > cutoff;
    const count = games[date].length;
    const caption = scheduled ? (count ? `${count} 场待赛` : '待公布') : (count ? `${count} 场` : '无比赛');
    const node = link(dateUrl(date), String(Number(date.slice(-2))), 'day');
    const detail = moves[date]?.length ? `，${moves[date].length} 条人员动态` : '';
    node.setAttribute('aria-label', `${dateLabel(date)}，${caption}${detail}`);
    node.append(el('small', caption));
    calendar.append(node);
  }
  section.append(calendar);
  return section;
}

function showCalendar() {
  main.append(
    el('h1', 'NBA 逐日归档'),
    el('p', `2026 年 10 月 1 日至 11 月 30 日 · 比分更新至 ${dateLabel(cutoff)}`, 'sub')
  );
  const calendars = el('div', '', 'calendars');
  calendars.append(monthCalendar('2026-10'), monthCalendar('2026-11'));
  main.append(calendars);
}

function gameCard(game) {
  const card = el('article', '', 'game');
  card.append(
    el('p', `${game.time} · ${game.type} · ${game.status}`, 'meta'),
    el('h3', `${game.away} 对 ${game.home}`)
  );
  if (game.status === '完赛') {
    card.append(el('p', `${game.as} : ${game.hs}`, 'result'));
    if (game.players?.length) {
      const players = game.players.map(([name, points]) => `${name} ${points} 分`);
      card.append(el('p', players.join(' · '), 'meta'));
    }
  }
  const sources = el('div', '', 'links');
  sources.append(link(`https://www.nba.com/game/${game.id}`, 'NBA 比赛中心'));
  if (highlights[game.id]) {
    sources.append(link(highlights[game.id], '腾讯体育全场集锦', 'video'));
  }
  card.append(sources);
  return card;
}

function showDay(date) {
  document.title = `${dateLabel(date)} NBA 资讯｜终场哨`;
  const index = dates.indexOf(date);
  const scheduled = date > cutoff;
  const dayGames = games[date];
  const dayMoves = moves[date] ?? [];
  main.append(el('h1', dateLabel(date)), el('p', 'NBA 赛果与动态 · 北京时间', 'sub'));
  const nav = el('nav', '', 'day-nav');
  nav.setAttribute('aria-label', '日期导航');
  if (index > 0) nav.append(link(dateUrl(dates[index - 1]), '前一天'));
  nav.append(link(`./index.html#${date.slice(0, 7)}`, '返回日历'));
  if (index < dates.length - 1) nav.append(link(dateUrl(dates[index + 1]), '后一天'));
  main.append(nav);
  if (date === '2026-11-22') {
    main.append(link('../2026-11-22/index.html', '阅读 11 月 22 日每日简报'));
  }

  const scores = el('section', '', 'detail');
  scores.append(el('h2', scheduled ? '待开赛' : '比赛'));
  if (dayGames.length) {
    if (scheduled) scores.append(el('p', '开赛时间以联盟后续公布为准。', 'sub'));
    const grid = el('div', '', 'games');
    grid.append(...dayGames.map(gameCard));
    scores.append(grid);
  } else {
    scores.append(el('p', scheduled ? '当前尚无已公布赛程。' : 'NBA 官方赛程显示当天没有比赛。'));
  }
  main.append(scores);

  if (dayMoves.length) {
    const news = el('section', '', 'detail');
    news.append(el('h2', '球队官宣'));
    for (const [title, summary, url] of dayMoves) {
      const article = el('article', '', 'game');
      article.append(el('h3', title), el('p', summary), link(url, '球队官方公告'));
      news.append(article);
    }
    main.append(news);
  }
  const source = el('div', '', 'links detail');
  const previousDate = new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
  source.append(
    link(`https://www.nba.com/games?date=${previousDate}`, 'NBA 官方赛程 · 北美前一日'),
    link(`https://www.nba.com/games?date=${date}`, 'NBA 官方赛程 · 北美同日')
  );
  if (dayGames.some(game => game.type === 'NBA 杯小组赛')) {
    source.append(link('https://www.nba.com/news/emirates-nba-cup-key-dates-schedule', 'NBA 杯官方赛程'));
  }
  main.append(source);
}

const requested = new URLSearchParams(location.search).get('date');
if (requested && Object.hasOwn(games, requested)) {
  showDay(requested);
} else {
  showCalendar();
}
