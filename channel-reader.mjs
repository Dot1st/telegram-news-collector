import { load } from 'cheerio';

export function parseChannelPage(html, source) {
  const $ = load(html);
  const items = [];
  let oldest = Infinity;
  $('.tgme_widget_message[data-post]').each((_, element) => {
    const node = $(element);
    const post = node.attr('data-post');
    const [username, number] = (post || '').split('/');
    if (username?.toLowerCase() !== source.target.toLowerCase() || !/^\d+$/.test(number)) return;
    oldest = Math.min(oldest, Number(number));
    if (node.find('.tgme_widget_message_error').length) return;
    const body = node.find('.tgme_widget_message_text').first().clone();
    body.find('br').replaceWith('\n');
    const mediaItems = [];
    node.find('video').each((_, video) => {
      const src = $(video).attr('src') || $(video).find('source').attr('src');
      if (src?.startsWith('https://')) mediaItems.push({ type: 'video', fileId: src });
    });
    node.find('.tgme_widget_message_photo_wrap').each((_, photo) => {
      const style = $(photo).attr('style') || '';
      const src = style.match(/background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/i)?.[1];
      if (src?.startsWith('https://')) mediaItems.push({ type: 'photo', fileId: src });
    });
    const text = body.text().trim();
    if (!text && !mediaItems.length) return;
    const hasHiddenVideo = node.find('.tgme_widget_message_video_player').length > mediaItems.filter(m => m.type === 'video').length;
    items.push({ sourceId: source.id, sourceUrl: `https://t.me/${post}`, text,
      publishedAt: node.find('time').attr('datetime') || new Date().toISOString(),
      mediaItems: mediaItems.slice(0, 10),
      mediaWarning: hasHiddenVideo ? 'ویدئوی این پست در پیش‌نمایش عمومی قابل دریافت نیست؛ لینک اصل خبر را پیش از تأیید بررسی کنید.' : null,
      messageNumber: Number(number),
    });
  });
  return { items: items.sort((a, b) => a.messageNumber - b.messageNumber), oldest };
}

export async function readChannel(source, cursor = 0, fetcher = fetch) {
  let before;
  const collected = new Map();
  let complete = false;
  for (let page = 0; page < 8; page++) {
    const url = `https://t.me/s/${source.target}${before ? '?before=' + before : ''}`;
    const response = await fetcher(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'NewsCollector/1.0' } });
    if (!response.ok) throw new Error(`Telegram preview HTTP ${response.status}`);
    const parsed = parseChannelPage(await response.text(), source);
    if (!Number.isFinite(parsed.oldest)) throw new Error('پیش‌نمایش عمومی منبع در دسترس نیست یا قالب آن تغییر کرده است.');
    for (const item of parsed.items) if (item.messageNumber > cursor) collected.set(item.messageNumber, item);
    if (!cursor || parsed.oldest <= cursor || parsed.oldest === before) { complete = true; break; }
    before = parsed.oldest;
  }
  // First activation starts with the five latest posts, not the full archive.
  const items = [...collected.values()].sort((a, b) => a.messageNumber - b.messageNumber);
  return { items: cursor ? items : items.slice(-5), complete };
}

export async function readRss(source, fetcher = fetch) {
  const response = await fetcher(source.target, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`RSS HTTP ${response.status}`);
  const $ = load(await response.text(), { xml: true });
  const items = [];
  $('item, entry').slice(0, 20).each((_, node) => {
    const entry = $(node);
    const title = entry.find('title').first().text();
    const summary = entry.find('description, summary, content').first().text();
    const plain = load(title + '\n\n' + summary).text().trim();
    const link = entry.find('link').first();
    const sourceUrl = link.attr('href') || link.text().trim() || source.target;
    if (!plain || !/^https?:\/\//.test(sourceUrl)) return;
    const rawDate = entry.find('pubDate, published, updated').first().text();
    items.push({ sourceId: source.id, text: plain.slice(0, 10000), sourceUrl,
      publishedAt: Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : new Date().toISOString(), mediaItems: [] });
  });
  if (!items.length) throw new Error('فید خبری آیتم قابل دریافت ندارد یا قالب آن تغییر کرده است.');
  return { items, complete: true };
}
