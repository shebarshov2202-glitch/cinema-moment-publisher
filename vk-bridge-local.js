const bridge = (() => {
  const isClient = typeof window !== 'undefined';
  const android = isClient ? window.AndroidBridge : null;
  const ios = isClient ? window.webkit?.messageHandlers : null;
  const isAndroid = !!android;
  const isIOS = !!(ios?.VKWebAppClose || ios?.VKWebAppInit);
  const isWeb = isClient && !isAndroid && !isIOS;
  let webFrameId;
  let seq = 0;
  const pending = new Map();

  function rawSend(method, params = {}) {
    if (isAndroid && typeof android?.[method] === 'function') {
      android[method](JSON.stringify(params));
      return;
    }
    if (isIOS && typeof ios?.[method]?.postMessage === 'function') {
      ios[method].postMessage(params);
      return;
    }
    if (isWeb && window.parent && typeof window.parent.postMessage === 'function') {
      window.parent.postMessage({
        handler: method,
        params,
        type: 'vk-connect',
        webFrameId,
        connectVersion: '2.14.0'
      }, '*');
      return;
    }
    throw new Error('VK Bridge runtime недоступен');
  }

  function handlePayload(payload) {
    if (!payload) return;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_) { return; }
    }
    const type = payload.type || payload?.detail?.type;
    const data = payload.data || payload?.detail?.data;
    const frameId = payload.frameId;
    if (type === 'VKWebAppSettings') {
      webFrameId = frameId;
      return;
    }
    if (!data || typeof data !== 'object') return;
    const requestId = data.request_id;
    if (!requestId || !pending.has(requestId)) return;
    const { request_id, ...rest } = data;
    const ctl = pending.get(requestId);
    pending.delete(requestId);
    if ('error_type' in rest) ctl.reject(rest);
    else ctl.resolve(rest);
  }

  if (isClient) {
    window.addEventListener('message', e => handlePayload(e.data));
    window.addEventListener('VKWebAppEvent', e => handlePayload(e.detail || e));
    document.addEventListener('VKWebAppEvent', e => handlePayload(e.detail || e));
  }

  return {
    send(method, props = {}) {
      return new Promise((resolve, reject) => {
        const requestId = props.request_id || `${++seq}_cinema_moment`;
        pending.set(requestId, { resolve, reject });
        try {
          rawSend(method, { ...props, request_id: requestId });
        } catch (error) {
          pending.delete(requestId);
          reject(error);
        }
      });
    }
  };
})();

export default bridge;
