const choose = document.querySelector('#choose');
const status = document.querySelector('#status');

choose.addEventListener('click', async () => {
  choose.disabled = true;
  status.textContent = OpenScreenI18n.t('Đang chờ bạn chọn nội dung…');
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 5, max: 10 } },
      audio: false,
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude'
    });
    const frame = await captureDisplayFrame(stream);
    const id = OpenScreen.uid('shot');
    await OpenScreenDB.saveDraft({ id, kind:'image', name:'Screen capture', createdAt:Date.now(), width:frame.width, height:frame.height, mimeType:'image/png', blob:frame.blob });
    status.textContent = OpenScreenI18n.t('Đã chụp — đang mở trình chỉnh sửa…');
    location.href = chrome.runtime.getURL(`editor/editor.html?id=${encodeURIComponent(id)}`);
  } catch (error) {
    console.error('Screen capture failed', error);
    status.textContent = error.name === 'NotAllowedError'
      ? OpenScreenI18n.t('Bạn đã hủy bộ chọn. Nhấn nút để thử lại.')
      : `${OpenScreenI18n.t('Lỗi:')} ${error.message}`;
    choose.disabled = false;
  } finally {
    stream?.getTracks().forEach(track => track.stop());
  }
});

async function captureDisplayFrame(stream) {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error(OpenScreenI18n.t('Không nhận được luồng hình ảnh từ nguồn đã chọn.'));

  // ImageCapture reads directly from the display track. This avoids waiting for a
  // hidden video element to paint, which is unreliable for Chrome tabs/windows.
  if ('ImageCapture' in window) {
    try {
      const bitmap = await new ImageCapture(track).grabFrame();
      try { return await bitmapToPng(bitmap); } finally { bitmap.close?.(); }
    } catch (error) {
      console.warn('ImageCapture fallback', error);
    }
  }

  return captureFromVideo(track);
}

async function captureFromVideo(track) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  try {
    await waitForVideoFrame(video);
    const width = video.videoWidth || track.getSettings().width;
    const height = video.videoHeight || track.getSettings().height;
    if (!width || !height) throw new Error(OpenScreenI18n.t('Nguồn đã chọn chưa sẵn sàng. Hãy thử lại.'));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    return { blob: await canvasToPng(canvas), width, height };
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

async function waitForVideoFrame(video) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(OpenScreenI18n.t('Không nhận được khung hình từ nguồn đã chọn.'))), 5000);
    const ready = () => {
      video.play().then(() => {
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => { clearTimeout(timeout); resolve(); });
        else setTimeout(() => { clearTimeout(timeout); resolve(); }, 180);
      }, reject);
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) ready();
    else video.addEventListener('loadedmetadata', ready, { once: true });
  });
}

async function bitmapToPng(bitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  return { blob: await canvasToPng(canvas), width: bitmap.width, height: bitmap.height };
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(OpenScreenI18n.t('Không thể tạo ảnh từ nguồn đã chọn.'))), 'image/png'));
}
