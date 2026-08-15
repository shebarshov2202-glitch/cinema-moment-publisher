const GROUP_ID = 212580744;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' }
  });
}

function vkHostAllowed(hostname) {
  const host = hostname.toLowerCase();
  return host === 'vk.com' || host.endsWith('.vk.com') || host === 'vk.ru' || host.endsWith('.vk.ru') || host === 'userapi.com' || host.endsWith('.userapi.com');
}

function imageHostAllowed(hostname) {
  const host = hostname.toLowerCase();
  return host === 'kinopoiskapiunofficial.tech' || host.endsWith('.kinopoiskapiunofficial.tech') || host === 'kinopoisk.ru' || host.endsWith('.kinopoisk.ru') || host === 'yandex.net' || host.endsWith('.yandex.net') || host === 'yandex.ru' || host.endsWith('.yandex.ru') || host === 'kinopoisk.cloud' || host.endsWith('.kinopoisk.cloud');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getRemoteImage(imageUrl) {
  let source;
  try { source = new URL(imageUrl); }
  catch { throw new Error('Некорректный image_url'); }

  if (source.protocol !== 'https:' || !imageHostAllowed(source.hostname)) {
    throw new Error(`Источник изображения запрещён: ${source.hostname}`);
  }

  let response = null;
  try {
    response = await fetchWithTimeout(source.toString(), { redirect: 'follow' }, 10000);
  } catch (_) {}

  if (!response || !response.ok) {
    const proxy = 'https://wsrv.nl/?url=' + encodeURIComponent(source.toString()) + '&output=jpg&q=90';
    try { response = await fetchWithTimeout(proxy, {}, 10000); }
    catch (_) { response = null; }
  }

  if (!response || !response.ok) throw new Error('Не удалось получить кадр за 20 секунд');
  const type = response.headers.get('Content-Type') || 'image/jpeg';
  if (!type.startsWith('image/')) throw new Error('Полученный файл не является изображением');
  return response.blob();
}

export async function onRequestPost(context) {
  try {
    const incoming = await context.request.formData();
    const uploadUrl = incoming.get('upload_url');
    const imageUrl = incoming.get('image_url');
    const uploadedFile = incoming.get('photo');

    if (typeof uploadUrl !== 'string' || !uploadUrl) return json({ ok:false, error:'upload_url is required' }, 400);

    let target;
    try { target = new URL(uploadUrl); }
    catch { return json({ ok:false, error:'Некорректный upload_url VK' }, 400); }

    if (target.protocol !== 'https:' || !vkHostAllowed(target.hostname)) {
      return json({ ok:false, error:'VK upload host is not allowed', host:target.hostname }, 403);
    }

    let imageBlob;
    if (typeof imageUrl === 'string' && imageUrl) imageBlob = await getRemoteImage(imageUrl);
    else if (uploadedFile && typeof uploadedFile.arrayBuffer === 'function') imageBlob = uploadedFile;
    else return json({ ok:false, error:'Нужен image_url или файл photo' }, 400);

    const outbound = new FormData();
    outbound.append('photo', imageBlob, 'cinema-moment.jpg');

    let vkResponse;
    try {
      vkResponse = await fetchWithTimeout(target.toString(), { method:'POST', body:outbound }, 15000);
    } catch (_) {
      return json({ ok:false, error:'VK не ответил на загрузку изображения за 15 секунд' }, 504);
    }

    const text = await vkResponse.text();
    return new Response(text, {
      status: vkResponse.status,
      headers: { 'Content-Type': vkResponse.headers.get('Content-Type') || 'application/json; charset=UTF-8', 'Cache-Control':'no-store' }
    });
  } catch (error) {
    return json({ ok:false, error:error?.message || String(error) }, 500);
  }
}

export function onRequestGet() {
  return json({ ok:true, route:'/vk-upload', group_id:GROUP_ID });
}
