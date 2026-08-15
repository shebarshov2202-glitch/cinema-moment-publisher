const GROUP_ID = 212580744;
const VK_API_VERSION = '5.199';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type':'application/json; charset=UTF-8', 'Cache-Control':'no-store' }
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal:controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestPost(context) {
  try {
    const text = await context.request.text();
    const incoming = new URLSearchParams(text);
    const accessToken = incoming.get('access_token');
    const ownerId = Number(incoming.get('owner_id'));
    const message = incoming.get('message') || '';
    const attachments = incoming.get('attachments') || '';
    const publishDate = incoming.get('publish_date');

    if (!accessToken) return json({ ok:false, error:'access_token is required' }, 400);
    if (ownerId !== -GROUP_ID) return json({ ok:false, error:'owner_id is not allowed' }, 403);
    if (!message && !attachments) return json({ ok:false, error:'Публикация пустая' }, 400);

    const body = new URLSearchParams();
    body.set('access_token', accessToken);
    body.set('owner_id', String(-GROUP_ID));
    body.set('from_group', '1');
    body.set('signed', '0');
    body.set('message', message);
    if (attachments) body.set('attachments', attachments);
    if (publishDate) body.set('publish_date', publishDate);
    body.set('v', VK_API_VERSION);

    let response;
    try {
      response = await fetchWithTimeout('https://api.vk.com/method/wall.post', {
        method:'POST',
        headers:{ 'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8' },
        body
      }, 15000);
    } catch (_) {
      return json({ ok:false, error:'VK wall.post не ответил за 15 секунд' }, 504);
    }

    const responseText = await response.text();
    return new Response(responseText, {
      status: response.status,
      headers:{ 'Content-Type':'application/json; charset=UTF-8', 'Cache-Control':'no-store' }
    });
  } catch (error) {
    return json({ ok:false, error:error?.message || String(error) }, 500);
  }
}

export function onRequestGet() {
  return json({ ok:true, route:'/vk-publish', group_id:GROUP_ID });
}
