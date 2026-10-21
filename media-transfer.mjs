import { parseChannelPage } from './channel-reader.mjs';

const PART_BYTES = 256 * 1024;
const MAX_BYTES = 48 * 1024 * 1024;

async function refreshedMedia(task, fetcher) {
  const match = task.sourceUrl.match(/^https:\/\/t\.me\/([A-Za-z0-9_]+)\/(\d+)$/);
  if (!match) return task.mediaItems;
  const res = await fetcher(`https://t.me/s/${match[1]}?before=${Number(match[2])+1}`, {signal:AbortSignal.timeout(20000)});
  if (!res.ok) throw new Error(`پیش‌نمایش منبع HTTP ${res.status}`);
  const page = parseChannelPage(await res.text(), {target:match[1]});
  return page.items.find(i => i.sourceUrl.toLowerCase() === task.sourceUrl.toLowerCase())?.mediaItems || task.mediaItems;
}

async function download(url, type, fetcher) {
  const response = await fetcher(url, {signal:AbortSignal.timeout(90000)});
  if (!response.ok) throw new Error(`دریافت فایل HTTP ${response.status}`);
  if (/text\/html|application\/json/i.test(response.headers.get('content-type') || '')) throw new Error('سرور به‌جای رسانه، صفحهٔ خطا برگرداند');
  const max = type === 'photo' ? 10*1024*1024 : MAX_BYTES;
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error(`فایل بزرگ‌تر از سقف ${max/1024/1024} مگابایت است`); }
  const chunks=[]; let size=0;
  for await (const chunk of response.body) {
    size+=chunk.length;
    if (size > max) throw new Error(`فایل بزرگ‌تر از سقف ${max/1024/1024} مگابایت است`);
    chunks.push(chunk);
  }
  if (!size) throw new Error('فایل خالی است');
  return Buffer.concat(chunks,size);
}

// No URLs, source names, file contents, or cloud credentials are logged here.
export async function transferPendingMedia(invoke, options = {}) {
  const fetcher=options.fetcher || fetch;
  const { tasks }=await invoke('getMediaTasks');
  const stats={ready:0,failed:0,deferred:0};
  const deadline=options.deadline || Date.now()+240000;
  for (const task of tasks.filter(t => !options.ids || options.ids.includes(t.id))) {
    if (Date.now()>deadline) { stats.deferred++; continue; }
    let fresh;
    try { fresh=await refreshedMedia(task,fetcher); }
    catch { fresh=task.mediaItems; }
    let allReady=true;
    for (let index=0;index<task.mediaItems.length;index++) {
      const media=task.mediaItems[index];
      if (!media.fileId.startsWith('https://')) continue;
      try {
        const current=fresh[index]?.type === media.type ? fresh[index] : media;
        const bytes=await download(current.fileId,media.type,fetcher);
        const parts=Math.ceil(bytes.length/PART_BYTES);
        for (let part=0;part<parts;part++) await invoke('storeMedia',{candidateId:task.id,mediaIndex:index,action:'part',partIndex:part,data:bytes.subarray(part*PART_BYTES,(part+1)*PART_BYTES).toString('base64')});
        await invoke('storeMedia',{candidateId:task.id,mediaIndex:index,action:'complete',parts,bytes:bytes.length});
      } catch (error) {
        options.onError?.(task.id, error);
        allReady=false;
        // Only controlled download messages can leave this process; unexpected
        // cloud failures may contain private request data and stay unprinted.
        const safe=/^(دریافت فایل HTTP \d+|پیش‌نمایش منبع HTTP \d+|فایل بزرگ‌تر از سقف \d+ مگابایت است|فایل خالی است|سرور به‌جای رسانه، صفحهٔ خطا برگرداند)$/.test(error.message) ? error.message : 'دریافت یا آپلود فایل ناموفق بود';
        await invoke('storeMedia',{candidateId:task.id,mediaIndex:index,action:'failed',error:safe});
        break;
      }
    }
    if(allReady) stats.ready++; else stats.failed++;
  }
  return stats;
}
