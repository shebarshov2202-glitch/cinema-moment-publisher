const GROUP_ID = 212580744;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function responseToSafeBlob(response) {
  if (!response || !response.ok) return null;

  const type = response.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) return null;

  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_IMAGE_BYTES) {
    throw new Error(`Кадр слишком тяжёлый: ${(declaredSize / 1024 / 1024).toFixed(1)} МБ`);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Кадр слишком тяжёлый: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} МБ`);
  }

  return new Blob([bytes], { type });
}

async function getRemoteImage(imageUrl) {
  let source;
  try {
    source = new URL(imageUrl);
  } catch {
    throw new Error('Некорректный image_url');
  }

  if (source.protocol !== 'https:' || !imageHostAllowed(source.hostname)) {
    throw new Error(`Источник изображения запрещён: ${source.hostname}`);
  }

  // Сначала всегда получаем облегчённую JPEG-копию. Это не даёт отдельным
  // тяжёлым кадрам рвать serverless-вызов и одновременно ускоряет VK upload.
  const optimizedUrl =
    'https://wsrv.nl/?url=' + encodeURIComponent(source.toString()) +
    '&w=1600&output=jpg&q=82';

  try {
    const optimized = await fetchWithTimeout(optimizedUrl, { redirect: 'follow' }, 15000);
    const blob = await responseToSafeBlob(optimized);
    if (blob) return blob;
  } catch (_) {
    // Ниже будет резервная попытка с оригиналом.
  }

  // Резерв: оригинал, но с жёстким лимитом размера и времени.
  try {
    const original = await fetchWithTimeout(source.toString(), { redirect: 'follow' }, 12000);
    const blob = await responseToSafeBlob(original);
    if (blob) return blob;
  } catch (error) {
    throw new Error(error?.message || 'Не удалось получить кадр');
  }

  throw new Error('Не удалось получить кадр в подходящем формате');
}

export default async function handler(req) {
  if (req.method === 'GET') {
    return json({ ok: true, route: '/vk-upload', group_id: GROUP_ID, version: 'optimized-2' });
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
      return json({ ok: false, error: 'VK upload host is not allowed', host: target.hostname }, 403);
    }

    let imageBlob;
    if (typeof imageUrl === 'string' && imageUrl) {
      imageBlob = await getRemoteImage(imageUrl);
    } else if (uploadedFile && typeof uploadedFile.arrayBuffer === 'function') {
      const bytes = await uploadedFile.arrayBuffer();
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        return json({ ok: false, error: 'Свой файл больше 8 МБ. Выбери изображение поменьше.' }, 413);
      }
      imageBlob = new Blob([bytes], { type: uploadedFile.type || 'image/jpeg' });
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
      }, 20000);
    } catch (_) {
      return json({ ok: false, error: 'VK не ответил на загрузку изображения за 20 секунд' }, 504);
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
    return json({ ok: false, error: error?.message || String(error) }, 500);
  }
}

export const config = {
  path: '/vk-upload'
};
