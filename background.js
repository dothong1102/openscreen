let activeCaptureJob = null;
const JOB_TIMEOUT = 5 * 60 * 1000;
const DB_NAME = 'openscreen-studio';
const DB_VERSION = 1;
const MEDIA_STORE = 'media';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const defaults = {
    settings: {
      imageFormat: 'png', jpegQuality: 0.92, delay: 3,
      resolution: '1080', fps: 30, bitrate: 8,
      format: 'webm', countdown: 3, microphone: false,
      camera: false, systemAudio: true, openEditor: true, autoCopyAfterCapture: false, language: 'vi'
    }
  };
  const current = await chrome.storage.local.get('settings');
  if (!current.settings) await chrome.storage.local.set(defaults);
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
});

chrome.commands.onCommand.addListener(async command => {
  if (command === 'capture-visible') {
    const started = startCaptureJob('visible', () => captureVisible());
    if (started.ok) openCaptureResult(await started.promise.catch(() => null));
  }
  if (command === 'capture-full-page') {
    const started = startCaptureJob('full-page', () => captureFullPage());
    if (started.ok) openCaptureResult(await started.promise.catch(() => null));
  }
  if (command === 'capture-selected') await startAreaSelection();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'offscreen') return false;
  if (message?.type === 'CAPTURE_VISIBLE' || message?.type === 'CAPTURE_FULL_PAGE') {
    const type = message.type === 'CAPTURE_VISIBLE' ? 'visible' : 'full-page';
    const task = message.type === 'CAPTURE_VISIBLE'
      ? () => captureVisible(message.delay || 0)
      : () => captureFullPage(message.delay || 0);
    const started = startCaptureJob(type, task);
    if (!started.ok) { sendResponse({ ok: false, error: started.error }); return false; }
    started.promise
      .then(result => {
        sendResponse({ ok: true, result: { completed: true, jobId: started.jobId, value: result } });
        openCaptureResult(result);
      })
      .catch(error => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }
  if (message?.type === 'AREA_SELECTED') {
    const started = startCaptureJob('selected-area', () => captureSelectedArea(sender.tab, message.rect));
    if (!started.ok) { sendResponse({ ok: false, error: started.error }); return false; }
    started.promise
      .then(result => {
        sendResponse({ ok: true, result: { completed: true, jobId: started.jobId, value: result } });
        openCaptureResult(result);
      })
      .catch(error => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }
  const actions = {
    SELECT_AREA: () => startAreaSelection(),
    OPEN_SCREEN_CAPTURE: () => chrome.tabs.create({ url: chrome.runtime.getURL('capture/capture.html') }),
    OPEN_RECORDER: () => chrome.tabs.create({ url: chrome.runtime.getURL(`recorder/recorder.html?mode=${encodeURIComponent(message.mode || 'screen')}`) }),
    OPEN_LIBRARY: () => chrome.tabs.create({ url: chrome.runtime.getURL('library/library.html') }),
    OPEN_OPTIONS: () => chrome.runtime.openOptionsPage()
  };
  const action = actions[message?.type];
  if (!action) return false;
  Promise.resolve(action()).then(result => sendResponse({ ok: true, result })).catch(error => sendResponse({ ok: false, error: friendlyError(error) }));
  return true;
});

function startCaptureJob(type, task) {
  if (activeCaptureJob) return { ok: false, error: 'Một tác vụ chụp khác đang chạy.' };
  const jobId = crypto.randomUUID();
  activeCaptureJob = { jobId, type, startedAt: Date.now() };
  setCaptureBadge('…', '#635bff');
  chrome.storage.local.remove('lastCaptureError').catch(() => {});
  const promise = withTimeout(Promise.resolve().then(task), JOB_TIMEOUT, 'Tác vụ chụp mất quá nhiều thời gian và đã được giải phóng.')
    .then(result => {
      chrome.storage.local.remove('lastCaptureError').catch(() => {});
      setCaptureBadge('', '#635bff');
      return result;
    })
    .catch(async error => {
      console.error(`[OpenScreen:${type}]`, error);
      const message = friendlyError(error);
      await chrome.storage.local.set({ lastCaptureError: { message, type, at: Date.now() } }).catch(() => {});
      setCaptureBadge('!', '#ef476f');
      throw error;
    })
    .finally(() => {
      if (activeCaptureJob?.jobId === jobId) activeCaptureJob = null;
    });
  return { ok: true, jobId, promise };
}

function setCaptureBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
  chrome.action.setBadgeText({ text }).catch(() => {});
}

function openCaptureResult(result) {
  if (!result?.openEditor || !result?.id) return;
  const copy = result.autoCopy ? '&copy=1' : '';
  setTimeout(() => chrome.tabs.create({ url: chrome.runtime.getURL(`editor/editor.html?id=${encodeURIComponent(result.id)}${copy}`) }).catch(() => {}), 50);
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function friendlyError(error) {
  const message = error?.message || String(error);
  if (/cannot access|chrome:\/\/|edge:\/\/|web store/i.test(message)) return 'Chrome không cho phép chụp trang hệ thống hoặc Chrome Web Store.';
  if (/busy/i.test(message)) return 'Một tác vụ chụp khác đang chạy.';
  return message;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Không tìm thấy tab đang hoạt động.');
  return tab;
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function processScreenshot(payload) {
  const id = await withTimeout(
    processScreenshotLocally(payload),
    60 * 1000,
    'Không thể hoàn tất xử lý ảnh trong 60 giây.'
  );
  const { settings = {} } = await chrome.storage.local.get('settings');
  return {
    id,
    autoCopy: settings.autoCopyAfterCapture === true,
    openEditor: settings.openEditor !== false || settings.autoCopyAfterCapture === true
  };
}

async function processScreenshotLocally(payload) {
  const blob = payload.segments?.length
    ? await stitchScreenshotSegments(payload.segments, payload.metrics)
    : await makeScreenshotBlob(payload.dataUrl, payload.crop, payload.viewport);
  const bitmap = await createImageBitmap(blob);
  const record = {
    id: `shot_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
    kind: 'image',
    name: payload.name || 'Screenshot',
    createdAt: Date.now(),
    width: bitmap.width,
    height: bitmap.height,
    mimeType: 'image/png',
    blob
  };
  bitmap.close?.();
  await saveScreenshotDraft(record);
  return record.id;
}

async function makeScreenshotBlob(dataUrl, crop, viewport) {
  const source = await (await fetch(dataUrl)).blob();
  if (!crop) return source;
  if (!viewport?.width || !viewport?.height) throw new Error('Không có kích thước vùng chụp.');
  const image = await createImageBitmap(source);
  const sx = image.width / viewport.width;
  const sy = image.height / viewport.height;
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(crop.width * sx)), Math.max(1, Math.round(crop.height * sy)));
  canvas.getContext('2d').drawImage(
    image,
    crop.x * sx, crop.y * sy, crop.width * sx, crop.height * sy,
    0, 0, canvas.width, canvas.height
  );
  image.close?.();
  return canvas.convertToBlob({ type: 'image/png' });
}

async function stitchScreenshotSegments(segments, metrics) {
  if (!metrics?.viewportWidth || !metrics?.viewportHeight) throw new Error('Không có kích thước trang để ghép ảnh.');
  const first = await createImageBitmap(await (await fetch(segments[0].dataUrl)).blob());
  const scaleX = first.width / metrics.viewportWidth;
  const scaleY = first.height / metrics.viewportHeight;
  const rawWidth = Math.round(metrics.fullWidth * scaleX);
  const rawHeight = Math.round(metrics.fullHeight * scaleY);
  const fit = Math.min(1, 30000 / rawWidth, 30000 / rawHeight, Math.sqrt(160_000_000 / (rawWidth * rawHeight)));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(rawWidth * fit)), Math.max(1, Math.round(rawHeight * fit)));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const image = index === 0 ? first : await createImageBitmap(await (await fetch(segment.dataUrl)).blob());
    const dx = Math.round(segment.x * scaleX * fit);
    const dy = Math.round(segment.y * scaleY * fit);
    const dw = Math.min(Math.round(image.width * fit), canvas.width - dx);
    const dh = Math.min(Math.round(image.height * fit), canvas.height - dy);
    if (dw > 0 && dh > 0) ctx.drawImage(image, 0, 0, dw / fit, dh / fit, dx, dy, dw, dh);
    image.close?.();
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

function openMediaDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        const store = db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('kind', 'kind');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Không thể mở thư viện ảnh.'));
  });
}

async function saveScreenshotDraft(record) {
  const db = await openMediaDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    tx.objectStore(MEDIA_STORE).put({ ...record, savedToLibrary: false });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Không thể tạo bản nháp ảnh chụp.'));
    tx.onabort = () => reject(tx.error || new Error('Tạo bản nháp ảnh chụp bị hủy.'));
  }).finally(() => db.close());
}

async function captureVisible(delay = 0) {
  const tab = await activeTab();
  if (delay) await wait(delay * 1000);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return processScreenshot({ dataUrl, name: `Visible — ${tab.title || 'Tab'}` });
}

async function injectCaptureScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/capture.js'] });
  }
}

async function startAreaSelection() {
  const tab = await activeTab();
  await injectCaptureScript(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type: 'BEGIN_AREA_SELECTION' });
}

async function captureSelectedArea(tab, rect) {
  if (!tab?.id || !rect) throw new Error('Vùng chọn không hợp lệ.');
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return processScreenshot({ dataUrl, crop: rect, viewport: { width: rect.viewportWidth, height: rect.viewportHeight }, name: `Selection — ${tab.title || 'Tab'}` });
}

async function captureFullPage(delay = 0) {
  let tab;
  try {
    tab = await activeTab();
    await injectCaptureScript(tab.id);
    if (delay) await wait(delay * 1000);
    const metrics = await chrome.tabs.sendMessage(tab.id, { type: 'PREPARE_FULL_PAGE' });
    if (!metrics?.ok) throw new Error(metrics?.error || 'Không thể đọc kích thước trang.');
    const positions = buildPositions(metrics.fullWidth, metrics.fullHeight, metrics.viewportWidth, metrics.viewportHeight);
    const segments = [];
    for (let index = 0; index < positions.length; index += 1) {
      const pos = positions[index];
      const actual = await chrome.tabs.sendMessage(tab.id, { type: 'SCROLL_FOR_CAPTURE', x: pos.x, y: pos.y, hideFixed: index > 0 });
      await wait(220);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      segments.push({ dataUrl, x: actual.x, y: actual.y });
      if (index < positions.length - 1) await wait(320);
    }
    await chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_AFTER_CAPTURE' });
    return await processScreenshot({ segments, metrics, name: `Full page — ${tab.title || 'Tab'}` });
  } finally {
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_AFTER_CAPTURE' }).catch(() => {});
  }
}

function axisPositions(total, viewport) {
  if (total <= viewport) return [0];
  const result = [];
  for (let p = 0; p < total - viewport; p += viewport) result.push(p);
  result.push(total - viewport);
  return [...new Set(result.map(Math.round))];
}

function buildPositions(fullWidth, fullHeight, viewportWidth, viewportHeight) {
  const xs = axisPositions(fullWidth, viewportWidth);
  const ys = axisPositions(fullHeight, viewportHeight);
  return ys.flatMap(y => xs.map(x => ({ x, y })));
}
