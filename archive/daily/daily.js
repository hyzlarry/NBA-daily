const { cutoff, games: archivedGames, moves, highlights } = nbaArchiveData;
const archivedIds = new Set(Object.values(archivedGames).flatMap(games => games.map(game => game.id)));
const firstDate = '2026-10-01';
const lastDate = '2027-06-30';
const dayLength = 86400000;
const dates = Array.from(
  { length: (Date.parse(lastDate) - Date.parse(firstDate)) / dayLength + 1 },
  (_, index) => new Date(Date.parse(firstDate) + index * dayLength).toISOString().slice(0, 10)
);
const months = [...new Set(dates.map(date => date.slice(0, 7)))];
const keyDatesUrl = 'https://www.nba.com/news/key-dates';
const cupUrl = 'https://www.nba.com/news/emirates-nba-cup-key-dates-schedule';
const allStarUrl = 'https://www.nba.com/allstar/2027/schedule';
const seasonScheduleUrl = 'https://pr.nba.com/2026-27-nba-regular-season-schedule';
const events = {
  '2027-02-20': [
    ['08:00', '全明星名人赛', allStarUrl],
    ['10:00', '全明星新秀挑战赛', allStarUrl]
  ],
  '2027-02-21': [['03:00', '全明星周末 HBCU 经典赛', allStarUrl]],
  '2027-02-22': [['09:00', 'NBA 全明星正赛', allStarUrl]]
};
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

function monthLabel(month) {
  const [year, number] = month.split('-').map(Number);
  return `${year} 年 ${number} 月`;
}

function dayGames(date) {
  const fixtures = nbaSeasonFixtures[date] ?? [];
  return archivedGames[date] ?? fixtures.filter(([id]) => !archivedIds.has(id)).map(([id, time, away, home, type = '常规赛']) => ({
    id, time, away, home, type, status: '未开赛'
  }));
}

function pendingStage(date) {
  if (date >= '2026-12-04' && date <= '2026-12-12') {
    return ['NBA 杯淘汰赛及同期补排的常规赛，具体对阵待联盟公布。', cupUrl];
  }
  if (date >= '2027-04-13') {
    return ['附加赛、季后赛及总决赛的逐场对阵和开球时间，以 NBA 后续公布为准。', keyDatesUrl];
  }
  return null;
}

function monthCalendar(month) {
  const section = el('section', '', 'month');
  section.id = month;
  const heading = el('h2', monthLabel(month));
  heading.id = `month-${month}`;
  section.setAttribute('aria-labelledby', heading.id);
  section.append(heading);
  if (month === '2026-10' || month === '2026-11') {
    section.append(link(`../${month}/index.html`, '阅读本月月报'));
  }

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
    const fixtures = dayGames(date);
    const count = fixtures.length;
    const completed = fixtures.filter(game => game.status === '完赛').length;
    let caption = '无比赛';
    if (count) caption = completed === count ? `${count} 场` : completed ? `${completed}/${count} 完赛` : `${count} 场赛程`;
    else if (events[date]) caption = '全明星';
    else if (pendingStage(date)) caption = '待公布';
    const node = link(dateUrl(date), String(Number(date.slice(-2))), 'day');
    const detail = moves[date]?.length ? `，${moves[date].length} 条人员动态` : '';
    node.setAttribute('aria-label', `${dateLabel(date)}，${caption}${detail}`);
    if (date === cutoff) node.setAttribute('aria-current', 'date');
    node.append(el('small', caption));
    calendar.append(node);
  }
  section.append(calendar);
  return section;
}

function showCalendar() {
  main.append(
    el('h1', '2026–27 赛季逐日归档'),
    el('p', `${dateLabel(firstDate)}至${dateLabel(lastDate)} · 比分更新至${dateLabel(cutoff)} · 北京时间`, 'sub')
  );
  const jump = el('nav', '', 'month-jump');
  jump.setAttribute('aria-label', '跳转到月份');
  jump.append(...months.map(month => link(`#${month}`, monthLabel(month))));
  main.append(jump);
  const calendars = el('div', '', 'calendars');
  calendars.append(...months.map(monthCalendar));
  main.append(calendars);
  document.getElementById(location.hash.slice(1))?.scrollIntoView();
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

function renderDailyBrief(date, fixtures, dayEvents, stage) {
  const section = el('section', '', 'detail briefing');
  section.id = 'daily-brief';
  section.setAttribute('aria-labelledby', 'daily-brief-title');
  const title = el('h2', '每日简报');
  title.id = 'daily-brief-title';
  section.append(title);

  const brief = nbaDailyBriefings.days[date];
  let summary = brief.summary;
  if (!summary && dayEvents.length) summary = '本日有 NBA 全明星周末活动，开场时间见下方赛程。';
  if (!summary && stage) summary = stage[0];
  if (!summary && date > cutoff) summary = '截至本次更新，联盟暂无该日的已公布比赛。';
  if (!summary) summary = 'NBA 官方赛程显示当天没有比赛。';
  section.append(el('p', summary, 'briefing-summary'));

  if (brief.entries.length) {
    const list = el('ul', '', 'briefing-list');
    for (const story of brief.entries) {
      const entry = el('li', '', 'briefing-item');
      const meta = story.time ? story.time + ' · ' + story.label : story.label;
      entry.append(el('p', meta, 'meta'), el('h3', story.title));
      if (story.detail) entry.append(el('p', story.detail));
      const links = el('div', '', 'links');
      if (story.url) links.append(link(story.url, '球队官方公告'));
      if (story.id) {
        links.append(link('https://www.nba.com/game/' + story.id, 'NBA 比赛中心'));
        const video = highlights[story.id];
        if (video) links.append(link(video, '腾讯体育全场集锦', 'video'));
      }
      entry.append(links);
      list.append(entry);
    }
    section.append(list);
  }
  if (date === '2026-11-22') {
    section.append(link('../2026-11-22/index.html', '阅读 11 月 22 日编辑简报', 'briefing-more'));
  }
  if (dayEvents.length) section.append(link(allStarUrl, 'NBA 全明星官方赛程', 'briefing-more'));
  if (stage && !fixtures.length) section.append(link(stage[1], 'NBA 官方阶段安排', 'briefing-more'));
  section.append(link('#day-sources', '查看当日来源', 'briefing-more'));
  return section;
}

function showDay(date) {
  document.title = `${dateLabel(date)} NBA 资讯｜终场哨`;
  const index = dates.indexOf(date);
  const fixtures = dayGames(date);
  const scheduled = fixtures.length > 0 && fixtures.every(game => game.status === '未开赛');
  const dayMoves = moves[date] ?? [];
  const dayEvents = events[date] ?? [];
  const stage = pendingStage(date);
  main.append(el('h1', dateLabel(date)), el('p', 'NBA 赛果与动态 · 北京时间', 'sub'));
  const nav = el('nav', '', 'day-nav');
  nav.setAttribute('aria-label', '日期导航');
  if (index > 0) nav.append(link(dateUrl(dates[index - 1]), '前一天'));
  nav.append(link(`./index.html#${date.slice(0, 7)}`, '返回日历'));
  if (index < dates.length - 1) nav.append(link(dateUrl(dates[index + 1]), '后一天'));
  main.append(nav);
  main.append(renderDailyBrief(date, fixtures, dayEvents, stage));

  const scores = el('section', '', 'detail');
  scores.append(el('h2', scheduled ? '待开赛' : '比赛'));
  if (fixtures.length) {
    if (scheduled) scores.append(el('p', '开赛时间以联盟后续公布为准。', 'sub'));
    const grid = el('div', '', 'games');
    grid.append(...fixtures.map(gameCard));
    scores.append(grid);
  } else if (stage) {
    scores.append(el('p', stage[0]), link(stage[1], '查看 NBA 官方公告'));
  } else {
    scores.append(el('p', date > cutoff ? '已公布的常规赛赛程当天无比赛。' : 'NBA 官方赛程显示当天没有比赛。'));
  }
  main.append(scores);

  if (dayEvents.length) {
    const section = el('section', '', 'detail');
    section.append(el('h2', '全明星赛程'));
    for (const [time, title, url] of dayEvents) {
      const article = el('article', '', 'game');
      article.append(el('p', `${time} · 待开赛`, 'meta'), el('h3', title), link(url, 'NBA 全明星官方赛程'));
      section.append(article);
    }
    main.append(section);
  }

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
  source.id = 'day-sources';
  const previousDate = new Date(Date.parse(date) - dayLength).toISOString().slice(0, 10);
  source.append(
    link(`https://www.nba.com/games?date=${previousDate}`, 'NBA 官方赛程 · 北美前一日'),
    link(`https://www.nba.com/games?date=${date}`, 'NBA 官方赛程 · 北美同日')
  );
  if (date > cutoff || scheduled) source.append(link(seasonScheduleUrl, 'NBA 官方赛季赛程'));
  if (fixtures.some(game => game.type === 'NBA 杯小组赛')) {
    source.append(link(cupUrl, 'NBA 杯官方赛程'));
  }
  main.append(source);
}

const requested = new URLSearchParams(location.search).get('date');
if (dates.includes(requested)) {
  showDay(requested);
  document.getElementById(location.hash.slice(1))?.scrollIntoView();
} else {
  showCalendar();
}
