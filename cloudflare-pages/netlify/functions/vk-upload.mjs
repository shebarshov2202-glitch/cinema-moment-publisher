const GROUP_ID = 212580744;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store'
    }
  });
}

function vkHostAllowed(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === 'vk.com' || host.endsWith('.vk.com') ||
    host === 'vk.ru' || host.endsWith('.vk.ru') ||
    host === 'userapi.com' || host.endsWith('.userapi.com')
  );
}

function imageHostAllowed(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === 'kinopoiskapiunofficial.tech' || host.endsWith('.kinopoiskapiunofficial.tech') ||
    host === 'kinopoisk.ru' || host.endsWith('.kinopoisk.ru') ||
    host === 'yandex.net' || host.endsWith('.yandex.net') ||
    host === 'yandex.ru' || host.endsWith('.yandex.ru') ||
    host === 'kinopoisk.cloud' || host.endsWith('.kinopoisk.cloud')
  );
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

async function responseToBlob(response) {
  if (!response?.ok) return null;

  const type = response.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) return null;

  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_IMAGE_BYTES) {
    throw new Error(`Кадр слишком тяжёлый: ${(length / 1024 / 1024).toFixed(1)} МБ`);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Кадр слишком тяжёлый: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} МБ`);
  }

  return new Blob([bytes], { type });
}

async function getRemoteImage(imageUrl, requestUrl) {
  let source;
  try {
    source = new URL(imageUrl);
  } catch {
    throw new Error('Некорректный image_url');
  }

  if (source.protocol !== 'https:' || !imageHostAllowed(source.hostname)) {
    throw new Error(`Источник изображения запрещён: ${source.hostname}`);
  }

  // Основной путь: встроенный Netlify Image CDN. Он сам забирает удалённый
  // кадр, уменьшает его и отдаёт лёгкий JPEG, который затем уходит в VK.
  const origin = new URL(requestUrl).origin;
  const cdnUrl =
    `${origin}/.netlify/images?url=${encodeURIComponent(source.toString())}` +
    '&w=1400&fm=jpg&q=80';

  try {
    const cdnResponse = await fetchWithTimeout(cdnUrl, {
      headers: { Accept: 'image/jpeg' }
    }, 10000);
    const blob = await responseToBlob(cdnResponse);
    if (blob) return blob;
  } catch (_) {
    // Ниже резервный прямой запрос.
  }

  // Резервный путь: исходный файл, но быстро и с лимитом размера.
  try {
    const direct = await fetchWithTimeout(source.toString(), {
      redirect: 'follow',
      headers: { Accept: 'image/jpeg,image/*;q=0.9,*/*;q=0.1' }
    }, 7000);
    const blob = await responseToBlob(direct);
    if (blob) return blob;
  } catch (error) {
    throw new Error(error?.message || 'Не удалось получить кадр');
  }

  throw new Error('Не удалось получить кадр через Netlify Image CDN');
}

export default async function handler(req) {
  if (req.method === 'GET') {
    return json({
      ok: true,
      route: '/vk-upload',
      group_id: GROUP_ID,
      version: 'imagecdn-3'
    });
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const incoming = await req.formData();
    const uploadUrl = incoming.get('upload_url');
    const imageUrl = incoming.get('image_url');
    const uploadedFile = incoming.get('photo');

    if (typeof uploadUrl !== 'string' || !uploadUrl) {
      return json({ ok: false, error: 'upload_url is required' }, 400);
    }

    let target;
    try {
      target = new URL(uploadUrl);
    } catch {
      return json({ ok: false, error: 'Некорректный upload_url VK' }, 400);
    }

    if (target.protocol !== 'https:' || !vkHostAllowed(target.hostname)) {
      return json({
        ok: false,
        error: 'VK upload host is not allowed',
        host: target.hostname
      }, 403);
    }

    let imageBlob;
    if (typeof imageUrl === 'string' && imageUrl) {
      imageBlob = await getRemoteImage(imageUrl, req.url);
    } else if (uploadedFile && typeof uploadedFile.arrayBuffer === 'function') {
      imageBlob = uploadedFile;
    } else {
      return json({ ok: false, error: 'Нужен image_url или файл photo' }, 400);
    }

    const outbound = new FormData();
    outbound.append('photo', imageBlob, 'cinema-moment.jpg');

    let vkResponse;
    try {
      vkResponse = await fetchWithTimeout(target.toString(), {
        method: 'POST',
        body: outbound
      }, 12000);
    } catch (_) {
      return json({
        ok: false,
        error: 'VK не ответил на загрузку изображения за 12 секунд'
      }, 504);
    }

    const text = await vkResponse.text();
    return new Response(text, {
      status: vkResponse.status,
      headers: {
        'Content-Type': vkResponse.headers.get('content-type') || 'application/json; charset=UTF-8',
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    return json({
      ok: false,
      error: error?.message || String(error)
    }, 500);
  }
}

export const config = {
  path: '/vk-upload'
};
