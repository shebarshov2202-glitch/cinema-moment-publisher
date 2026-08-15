import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GROUP_ID = 212580744;
const VK_API_VERSION = '5.199';
const PORT = Number(process.env.PORT || 3000);

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

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

  let response = null;
  try {
    response = await fetchWithTimeout(source.toString(), { redirect: 'follow' }, 12000);
  } catch (_) {
    response = null;
  }

  if (!response || !response.ok) {
    const proxy = 'https://wsrv.nl/?url=' + encodeURIComponent(source.toString()) + '&output=jpg&q=90';
    try {
      response = await fetchWithTimeout(proxy, {}, 12000);
    } catch (_) {
      response = null;
    }
  }

  if (!response || !response.ok) {
    throw new Error('Не удалось получить изображение за отведённое время');
  }

  const type = response.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) {
    throw new Error('Полученный файл не является изображением');
  }

  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), type };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Cinema Moment Publisher', host: 'Timeweb-ready' });
});

app.post('/vk-upload', upload.single('photo'), async (req, res) => {
  try {
    const uploadUrl = req.body?.upload_url;
    const imageUrl = req.body?.image_url;

    if (!uploadUrl) {
      return res.status(400).json({ ok: false, error: 'upload_url is required' });
    }

    let target;
    try {
      target = new URL(uploadUrl);
    } catch {
      return res.status(400).json({ ok: false, error: 'Некорректный upload_url VK' });
    }

    if (target.protocol !== 'https:' || !vkHostAllowed(target.hostname)) {
      return res.status(403).json({ ok: false, error: 'VK upload host is not allowed', host: target.hostname });
    }

    let buffer;
    let mimeType = 'image/jpeg';

    if (imageUrl) {
      const remote = await getRemoteImage(imageUrl);
      buffer = remote.buffer;
      mimeType = remote.type;
    } else if (req.file?.buffer) {
      buffer = req.file.buffer;
      mimeType = req.file.mimetype || mimeType;
    } else {
      return res.status(400).json({ ok: false, error: 'Нужен image_url или файл photo' });
    }

    const form = new FormData();
    form.append('photo', new Blob([buffer], { type: mimeType }), 'cinema-moment.jpg');

    let vkResponse;
    try {
      vkResponse = await fetchWithTimeout(target.toString(), {
        method: 'POST',
        body: form
      }, 20000);
    } catch {
      return res.status(504).json({ ok: false, error: 'VK не ответил на загрузку изображения за 20 секунд' });
    }

    const text = await vkResponse.text();
    res.status(vkResponse.status);
    res.type(vkResponse.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
});

app.post('/vk-publish', async (req, res) => {
  try {
    const accessToken = req.body?.access_token;
    const ownerId = Number(req.body?.owner_id);
    const message = req.body?.message || '';
    const attachments = req.body?.attachments || '';
    const publishDate = req.body?.publish_date || '';

    if (!accessToken) {
      return res.status(400).json({ ok: false, error: 'access_token is required' });
    }

    if (ownerId !== -GROUP_ID) {
      return res.status(403).json({ ok: false, error: 'owner_id is not allowed' });
    }

    if (!message && !attachments) {
      return res.status(400).json({ ok: false, error: 'Публикация пустая' });
    }

    const body = new URLSearchParams();
    body.set('access_token', accessToken);
    body.set('owner_id', String(ownerId));
    body.set('from_group', '1');
    body.set('signed', '0');
    body.set('message', message);
    if (attachments) body.set('attachments', attachments);
    if (publishDate) body.set('publish_date', publishDate);
    body.set('v', VK_API_VERSION);

    let vkResponse;
    try {
      vkResponse = await fetchWithTimeout('https://api.vk.com/method/wall.post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body
      }, 20000);
    } catch {
      return res.status(504).json({ ok: false, error: 'VK wall.post не ответил за 20 секунд' });
    }

    const text = await vkResponse.text();
    res.status(vkResponse.status);
    res.type('application/json');
    res.send(text);
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
}));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Cinema Moment Publisher listening on port ${PORT}`);
});
