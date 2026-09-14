(() => {
  if (window.__openScreenCaptureLoaded) return;
  window.__openScreenCaptureLoaded = true;
  let overlay;
  let originalScroll = { x: 0, y: 0 };
  let hiddenElements = [];
  let scrollBehavior = '';
  let language = 'vi';
  chrome.storage.local.get('settings').then(({ settings = {} }) => { language = settings.language === 'en' ? 'en' : 'vi'; }).catch(() => {});

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING') { sendResponse({ ok: true }); return; }
    if (message.type === 'BEGIN_AREA_SELECTION') beginSelection();
    if (message.type === 'PREPARE_FULL_PAGE') sendResponse(prepareFullPage());
    if (message.type === 'SCROLL_FOR_CAPTURE') {
      setFixedVisibility(message.hideFixed);
      window.scrollTo(message.x, message.y);
      requestAnimationFrame(() => requestAnimationFrame(() => sendResponse({ x: window.scrollX, y: window.scrollY })));
      return true;
    }
    if (message.type === 'RESTORE_AFTER_CAPTURE') { restorePage(); sendResponse({ ok: true }); }
  });

  function prepareFullPage() {
    originalScroll = { x: window.scrollX, y: window.scrollY };
    scrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    const body = document.body;
    const root = document.documentElement;
    const fullWidth = Math.max(body?.scrollWidth || 0, body?.offsetWidth || 0, root.scrollWidth, root.offsetWidth, root.clientWidth);
    const fullHeight = Math.max(body?.scrollHeight || 0, body?.offsetHeight || 0, root.scrollHeight, root.offsetHeight, root.clientHeight);
    hiddenElements = [...document.querySelectorAll('*')].filter(el => {
      const style = getComputedStyle(el);
      return (style.position === 'fixed' || style.position === 'sticky') && style.visibility !== 'hidden';
    }).map(el => ({ el, visibility: el.style.visibility }));
    // captureVisibleTab includes the browser's scrollbar pixels, whereas
    // clientWidth/clientHeight describe only the document viewport. Keep both
    // measurements so the service worker can crop those pixels before stitching.
    return {
      ok: true,
      fullWidth,
      fullHeight,
      viewportWidth: root.clientWidth,
      viewportHeight: root.clientHeight,
      captureWidth: window.innerWidth,
      captureHeight: window.innerHeight,
      originalScroll
    };
  }

  function setFixedVisibility(hidden) {
    hiddenElements.forEach(({ el }) => { el.style.visibility = hidden ? 'hidden' : ''; });
  }

  function restorePage() {
    hiddenElements.forEach(({ el, visibility }) => { el.style.visibility = visibility; });
    document.documentElement.style.scrollBehavior = scrollBehavior;
    window.scrollTo(originalScroll.x, originalScroll.y);
    hiddenElements = [];
  }

  function beginSelection() {
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(16,22,38,.22);font-family:system-ui,sans-serif;';
    const tip = document.createElement('div');
    tip.textContent = language === 'en' ? 'Drag to select an area • Esc to cancel' : 'Kéo để chọn vùng • Esc để hủy';
    tip.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);background:#171e30;color:#fff;padding:10px 15px;border-radius:12px;font-size:13px;font-weight:700;box-shadow:0 10px 35px #0004;';
    overlay.append(tip);
    document.documentElement.append(overlay);

    let start;
    let box;
    const cleanup = () => { overlay?.remove(); overlay = null; document.removeEventListener('keydown', keyHandler, true); };
    const keyHandler = event => { if (event.key === 'Escape') cleanup(); };
    document.addEventListener('keydown', keyHandler, true);
    overlay.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      box = document.createElement('div');
      box.style.cssText = 'position:absolute;border:2px solid #7c5cff;background:rgba(124,92,255,.13);box-shadow:0 0 0 99999px rgba(10,15,28,.38);';
      overlay.innerHTML = ''; overlay.append(box);
      overlay.setPointerCapture(event.pointerId);
    });
    overlay.addEventListener('pointermove', event => {
      if (!start || !box) return;
      const x = Math.min(start.x, event.clientX), y = Math.min(start.y, event.clientY);
      const width = Math.abs(event.clientX - start.x), height = Math.abs(event.clientY - start.y);
      Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
      box.textContent = width > 90 && height > 35 ? `${Math.round(width)} × ${Math.round(height)}` : '';
      box.style.color = 'white'; box.style.fontSize = '12px'; box.style.padding = '6px';
    });
    overlay.addEventListener('pointerup', event => {
      if (!start) return cleanup();
      const rect = { x: Math.min(start.x, event.clientX), y: Math.min(start.y, event.clientY), width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y), viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
      cleanup();
      if (rect.width >= 5 && rect.height >= 5) {
        // captureVisibleTab can read the compositor's previous frame if the
        // request is made in the same event turn that removes this overlay.
        // Wait for the removal to be painted before asking the background
        // worker to capture, so the dimmed selection mask never leaks into
        // the resulting image.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          setTimeout(() => chrome.runtime.sendMessage({ type: 'AREA_SELECTED', rect }), 40);
        }));
      }
    });
  }
})();
