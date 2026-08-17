from pathlib import Path

p = Path('cloudflare-pages/public/index.html')
s = p.read_text(encoding='utf-8')

start_marker = '    log(`Вызываю server-side wall.post с пользовательским токеном:'
end_marker = '    const postId = result?.post_id ?? result;\n'

if start_marker not in s:
    raise SystemExit('old server-side wall.post block not found')

start = s.index(start_marker)
end = s.index(end_marker, start) + len(end_marker)

replacement = """    log(`Вызываю wall.post напрямую из браузера: owner_id=${-Math.abs(groupId)}, publish_date=${publishDate}, attachments=${attachments.length}`);
    const body = new URLSearchParams();
    body.set('access_token',accessToken);
    body.set('owner_id',String(-Math.abs(groupId)));
    body.set('from_group','1');
    body.set('signed','0');
    body.set('message',message);
    body.set('attachments',attachments.join(','));
    body.set('publish_date',String(publishDate));
    body.set('v',VK_API_VERSION);

    const controller = new AbortController();
    const publishTimer = setTimeout(() => controller.abort(), 20000);
    let publishResponse;
    try {
      publishResponse = await fetch('https://api.vk.com/method/wall.post',{
        method:'POST',
        headers:{ 'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8' },
        body,
        signal:controller.signal,
        credentials:'omit'
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('wall.post: VK не ответил за 20 секунд.');
      throw new Error(`wall.post: сетевой запрос из браузера не прошёл — ${errorText(error)}`);
    } finally {
      clearTimeout(publishTimer);
    }

    const publishText = await publishResponse.text();
    if (!publishResponse.ok) throw new Error(`VK wall.post HTTP ${publishResponse.status} — ${publishText.slice(0,300)}`);
    let publishJson;
    try { publishJson = JSON.parse(publishText); }
    catch (_) { throw new Error(`VK wall.post вернул не JSON: ${publishText.slice(0,300)}`); }
    if (publishJson?.error) throw new Error(`VK wall.post · code=${publishJson.error.error_code} · ${publishJson.error.error_msg}`);
    const result = publishJson?.response;
    const postId = result?.post_id ?? result;
"""

s = s[:start] + replacement + s[end:]
p.write_text(s, encoding='utf-8')

check = p.read_text(encoding='utf-8')
assert 'Вызываю wall.post напрямую из браузера' in check
assert 'Вызываю server-side wall.post с пользовательским токеном' not in check
assert "fetch('https://api.vk.com/method/wall.post'" in check
print('Netlify wall.post block patched successfully')
