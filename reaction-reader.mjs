import { load } from 'cheerio';

function reactionCount(value) {
  const digits=String(value).trim().replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[,٬\s]/g,'');
  const match=digits.match(/^(\d+(?:\.\d+)?)([KM])?$/i);
  if(!match) throw new Error('Source reaction counter is unreadable');
  return Math.round(Number(match[1])*(match[2]?.toUpperCase()==='M' ? 1000000 : match[2]?.toUpperCase()==='K' ? 1000 : 1));
}

export function parseSourceReactions(html, sourceUrl) {
  const match=sourceUrl.match(/^https:\/\/t\.me\/([A-Za-z0-9_]+)\/(\d+)$/);
  if(!match) throw new Error('Invalid source post URL');
  const $=load(html);
  const post=$('.tgme_widget_message[data-post]').filter((_,el)=>$(el).attr('data-post')?.toLowerCase()===`${match[1]}/${match[2]}`.toLowerCase()).first();
  if(!post.length || post.find('.tgme_widget_message_error').length) throw new Error('Source post is unavailable');
  const publishedAt=post.find('time[datetime]').first().attr('datetime');
  if(!Number.isFinite(Date.parse(publishedAt))) throw new Error('Source publication time is unavailable');
  const reactions=[];
  post.find('.tgme_widget_message_reactions .tgme_reaction').each((_,el)=>{
    const reaction=$(el);
    const text=reaction.clone();
    text.find('.emoji,tg-emoji,.tg-emoji,img,svg').remove();
    const count=reactionCount(text.text());
    const custom=reaction.find('tg-emoji,.tg-emoji,[data-emoji-id]').length>0;
    const emoji=reaction.find('.emoji b').first().text() || reaction.find('img.emoji').first().attr('alt');
    reactions.push({type:custom ? 'custom_emoji' : emoji ? 'emoji' : 'unknown',emoji:custom ? null : emoji || null,count});
  });
  return {sourceUrl,publishedAt,reactions};
}

export async function readSourceReactions(sourceUrl,fetcher=fetch) {
  const match=sourceUrl.match(/^https:\/\/t\.me\/([A-Za-z0-9_]+)\/(\d+)$/);
  if(!match) throw new Error('Invalid source post URL');
  const response=await fetcher(`https://t.me/s/${match[1]}?before=${Number(match[2])+1}`,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'NewsCollector/1.0'}});
  if(!response.ok) throw new Error(`Source reaction HTTP ${response.status}`);
  return {...parseSourceReactions(await response.text(),sourceUrl),observedAt:new Date().toISOString()};
}

export async function syncPendingReactions(invoke,options={}) {
  const {tasks}=await invoke('getReactionTasks');
  const observations=[];
  const applyIds=tasks.filter(t=>t.action==='apply').map(t=>t.candidateId);
  const reads=tasks.filter(t=>t.action==='read');
  for(let i=0;i<reads.length;i+=4) {
    const batch=await Promise.all(reads.slice(i,i+4).map(async task=>{
      try {return {candidateId:task.candidateId,...await readSourceReactions(task.sourceUrl,options.fetcher)};}
      catch {return {candidateId:task.candidateId,sourceUrl:task.sourceUrl,error:'خواندن شمارنده‌های ری‌اکشن منبع ناموفق بود؛ دوباره بررسی می‌شود.'};}
    }));
    observations.push(...batch);
  }
  if(!observations.length && !applyIds.length) return {saved:0,applied:0,unavailable:0,errors:0};
  return await invoke('syncReactions',{observations,applyIds});
}
