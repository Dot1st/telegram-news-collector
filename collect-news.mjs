import { getFiles, runFunction } from './node_modules/@tgcloud/cli/src/api/endpoints.js';
import { readChannel, readRss } from './channel-reader.mjs';

// Credentials come only from the runner's encrypted secret, never local CLI state.
const token = process.env.TGCLOUD_TOKEN;
const editorId = Number(process.env.COLLECTOR_EDITOR_ID);
if (!token) throw new Error('Set TGCLOUD_TOKEN in the scheduler secret store.');
if (!Number.isSafeInteger(editorId) || editorId <= 0) throw new Error('Set COLLECTOR_EDITOR_ID in the scheduler secret store.');
const cloud = await getFiles(token);
const modules = cloud.canonical_modules;
const ctx = { initData: { user: { id: editorId } } };
const invoke = async (name, input = {}) => {
  const result = await runFunction(token, `endpoints/${name}`, modules, input, ctx);
  if (result.error) throw new Error(result.error.description || result.error.message || 'Cloud invocation failed');
  return result.result;
};
const config = await invoke('getCollectorConfig');
if (!Array.isArray(config?.sources)) throw new Error('Collector endpoints are not deployed or returned an invalid result.');
const sources = config.sources.filter(s => s.enabled);
const results = await Promise.all(sources.map(async source => {
  try {
    const result = source.kind === 'telegram'
      ? await readChannel(source, config.cursors?.[source.id] || 0) : await readRss(source);
    return { source, ...result };
  } catch (error) {
    return { source, items: [], complete: false, error: String(error.message).replace(/app\d+:[^\s]+/g, '[REDACTED]').slice(0, 160) };
  }
}));
// Across sources, the earliest publication seen in this collection wins.
const items = results.flatMap(r => r.items).sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.sourceUrl.localeCompare(b.sourceUrl));
const failedSources = new Set();
const summary = { queued: 0, skipped: 0 };
for (let i = 0; i < items.length; i += 10) {
  const batch = items.slice(i, i + 10);
  const result = await invoke('ingestBatch', { items: batch });
  summary.queued += result.queued || 0;
  summary.skipped += result.skipped || 0;
  for (const error of result.errors || []) {
    const source = sources.find(s => s.label === error.source || s.id === error.source);
    if (source) failedSources.add(source.id);
    else batch.forEach(item => failedSources.add(item.sourceId));
  }
}
const health = results.map(r => ({ sourceId: r.source.id, ok: r.complete && !failedSources.has(r.source.id), received: r.items.length,
  cursor: r.items.at(-1)?.messageNumber || config.cursors?.[r.source.id] || 0,
  error: r.error || (failedSources.has(r.source.id) ? 'برخی خبرها ثبت نشدند؛ اجرای بعد دوباره تلاش می‌کند.' : !r.complete ? 'بیش از هشت صفحه عقب‌ماندگی؛ احتمال شکاف در دریافت وجود دارد.' : ''),
}));
await invoke('ingestBatch', { items: [], health, finalBatch: true, summary });
for (const status of health) console.log(`${status.sourceId}: ${status.ok ? 'OK' : 'FAILED'}, ${status.received} posts checked`);
console.log(`Queued: ${summary.queued}, skipped: ${summary.skipped}`);
if (health.some(s => !s.ok)) process.exitCode = 1;
