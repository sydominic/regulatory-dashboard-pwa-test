import * as cheerio from 'cheerio';
import { fetchText } from './httpClient.js';
import { dateInRange, isBadTitle, norm, normalizeMfdsUrl, parseDateAny, parseRssDate } from './textUtils.js';

function rssUrls(brdId) {
  if (!brdId) return [];
  return [
    `https://www.mfds.go.kr/www/rss/brd.do?brdId=${encodeURIComponent(brdId)}`,
    `http://www.mfds.go.kr/www/rss/brd.do?brdId=${encodeURIComponent(brdId)}`
  ];
}

function textOf($, el, selector) {
  return norm($(el).find(selector).first().text());
}

export async function collectRssSource(source, startDate, endDate) {
  const rows = [];
  const errors = [];
  const stats = { source: 'rss', checked: 0, inRange: 0, feedUrl: null };
  if (!source.rssBrdId) return { rows, errors, stats };

  let xml = '';
  let finalUrl = '';
  for (const url of rssUrls(source.rssBrdId)) {
    try {
      const fetched = await fetchText(url, { accept: 'application/rss+xml,application/xml,text/xml,*/*;q=0.8', timeoutMs: 7000, attempts: 1 });
      if (!/<item[\s>]/i.test(fetched.text)) {
        throw new Error('RSS item 태그를 찾지 못함');
      }
      xml = fetched.text;
      finalUrl = fetched.finalUrl || url;
      break;
    } catch (err) {
      errors.push(`${source.board_id} RSS ${url}: ${err?.message || err}`);
    }
  }

  if (!xml) return { rows, errors, stats };
  stats.feedUrl = finalUrl;

  const $ = cheerio.load(xml, { xmlMode: true, decodeEntities: true });
  $('item').each((_, item) => {
    const title = textOf($, item, 'title');
    if (isBadTitle(title)) return;
    const linkText = textOf($, item, 'link') || textOf($, item, 'guid');
    const description = textOf($, item, 'description');
    const pubDate = textOf($, item, 'pubDate') || textOf($, item, 'dc\\:date') || textOf($, item, 'date');
    const itemDate = parseRssDate(pubDate) || parseDateAny(`${title} ${description}`);
    const url = normalizeMfdsUrl(linkText || source.url, source.url);

    stats.checked += 1;
    if (!itemDate || !dateInRange(itemDate, startDate, endDate)) return;
    stats.inRange += 1;
    rows.push({
      site: '식약처',
      category: source.category,
      board_id: source.board_id,
      item_date: itemDate,
      title,
      url,
      source_type: 'rss'
    });
  });

  return { rows, errors, stats };
}
