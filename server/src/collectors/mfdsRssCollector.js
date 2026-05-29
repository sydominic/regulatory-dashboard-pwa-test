import * as cheerio from 'cheerio';
import { fetchText } from './httpClient.js';
import { dateInRange, isBadTitle, norm, normalizeMfdsUrl, parseDateAny, parseRssDate } from './textUtils.js';

function rssUrls(brdId) {
  if (!brdId) return [];
  // MFDS official RSS list publishes http URLs. Try http first, then https fallback.
  return [
    `http://www.mfds.go.kr/www/rss/brd.do?brdId=${encodeURIComponent(brdId)}`,
    `https://www.mfds.go.kr/www/rss/brd.do?brdId=${encodeURIComponent(brdId)}`
  ];
}

function textOf($, el, selector) {
  return norm($(el).find(selector).first().text());
}

function rssSnippet(text) {
  return norm(String(text || '').replace(/<[^>]+>/g, ' ')).slice(0, 1000);
}

export async function collectRssSource(source, startDate, endDate) {
  const rows = [];
  const errors = [];
  const stats = {
    source: 'rss',
    checked: 0,
    inRange: 0,
    feedUrl: null,
    triedUrls: [],
    lastStatus: null,
    lastContentType: '',
    transport: '',
    fallbackFrom: '',
    fallbackReason: '',
    bodyLength: 0,
    itemTagCount: 0,
    snippet: '',
    rawStartsWith: '',
    parseMode: 'item-tag'
  };
  if (!source.rssBrdId) return { rows, errors, stats };

  let xml = '';
  let finalUrl = '';
  for (const url of rssUrls(source.rssBrdId)) {
    stats.triedUrls.push(url);
    try {
      const fetched = await fetchText(url, { accept: 'application/rss+xml,application/xml,text/xml,text/html,*/*;q=0.8', timeoutMs: 20000, attempts: 2, referer: 'https://www.mfds.go.kr/www/rss/list.do' });
      stats.lastStatus = fetched.status || null;
      stats.lastContentType = fetched.contentType || '';
      stats.transport = fetched.transport || '';
      stats.fallbackFrom = fetched.fallbackFrom || '';
      stats.fallbackReason = fetched.fallbackReason || '';
      stats.bodyLength = fetched.text.length;
      stats.snippet = rssSnippet(fetched.text);
      stats.rawStartsWith = String(fetched.text || '').trim().slice(0, 80);
      const itemCount = (fetched.text.match(/<item[\s>]/gi) || []).length;
      stats.itemTagCount = itemCount;
      if (!itemCount) {
        throw new Error(`RSS item 태그 0개 bodyLength=${fetched.text.length} contentType=${stats.lastContentType}`);
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
