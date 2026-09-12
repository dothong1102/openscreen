(() => {
  function uid(prefix = 'item') {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  }
  function filename(prefix, extension) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${prefix}-${stamp}.${extension}`;
  }
  function formatBytes(bytes = 0) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
  }
  function formatDuration(ms = 0) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }
  function toast(message) {
    message = window.OpenScreenI18n?.t?.(message) || message;
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.append(el); }
    el.textContent = message; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  window.OpenScreen = { uid, filename, formatBytes, formatDuration, toast };
})();
