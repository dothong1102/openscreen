chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;
  if (message.type === 'PING_OFFSCREEN') { sendResponse({ ok: true }); return false; }
  if (message.type !== 'PROCESS_SCREENSHOT') return false;
  processScreenshot(message).then(id => sendResponse({ ok: true, id })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function processScreenshot(message) {
  let canvas;
  if (message.segments?.length) canvas = await stitch(message.segments, message.metrics);
  else canvas = await cropSingle(message.dataUrl, message.crop, message.viewport);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Ảnh quá lớn để trình duyệt mã hóa. Hãy giảm kích thước trang hoặc mức zoom.');
  const id = `shot_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  await OpenScreenDB.saveDraft({ id, kind: 'image', name: message.name || 'Screenshot', createdAt: Date.now(), width: canvas.width, height: canvas.height, mimeType: 'image/png', blob });
  return id;
}

async function loadImage(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return image;
}

async function cropSingle(dataUrl, crop, viewport) {
  const image = await loadImage(dataUrl);
  if (!crop) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas;
  }
  const sx = image.naturalWidth / viewport.width;
  const sy = image.naturalHeight / viewport.height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width * sx));
  canvas.height = Math.max(1, Math.round(crop.height * sy));
  canvas.getContext('2d').drawImage(image, crop.x * sx, crop.y * sy, crop.width * sx, crop.height * sy, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function stitch(segments, metrics) {
  const first = await loadImage(segments[0].dataUrl);
  const scaleX = first.naturalWidth / metrics.viewportWidth;
  const scaleY = first.naturalHeight / metrics.viewportHeight;
  const rawWidth = Math.round(metrics.fullWidth * scaleX);
  const rawHeight = Math.round(metrics.fullHeight * scaleY);
  const maxDimension = 30000;
  const maxPixels = 160_000_000;
  const fit = Math.min(1, maxDimension / rawWidth, maxDimension / rawHeight, Math.sqrt(maxPixels / (rawWidth * rawHeight)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rawWidth * fit));
  canvas.height = Math.max(1, Math.round(rawHeight * fit));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const image = i === 0 ? first : await loadImage(segment.dataUrl);
    const dx = Math.round(segment.x * scaleX * fit);
    const dy = Math.round(segment.y * scaleY * fit);
    const dw = Math.min(Math.round(image.naturalWidth * fit), canvas.width - dx);
    const dh = Math.min(Math.round(image.naturalHeight * fit), canvas.height - dy);
    if (dw > 0 && dh > 0) ctx.drawImage(image, 0, 0, dw / fit, dh / fit, dx, dy, dw, dh);
  }
  return canvas;
}
