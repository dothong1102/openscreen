const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
init();
async function init() {
  await OpenScreenI18n.ready;
  const { settings = {}, lastCaptureError } = await chrome.storage.local.get(['settings', 'lastCaptureError']);
  ['openEditor', 'autoCopyAfterCapture'].forEach(key => { if (typeof settings[key] === 'boolean' && $(`#${key}`)) $(`#${key}`).checked = settings[key]; });
  if (settings.delay) $('#delay').value = String(settings.delay);
  if (lastCaptureError?.message) {
    setTimeout(() => OpenScreen.toast(lastCaptureError.message), 80);
    await chrome.storage.local.remove('lastCaptureError');
    await chrome.action.setBadgeText({ text: '' });
  }
}

$$('.tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.tab').forEach(el => el.classList.toggle('active', el === tab));
  $$('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `${tab.dataset.tab}-panel`));
}));

$$('[data-action]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true;
  button.dataset.originalLabel = button.innerHTML;
  if (button.classList.contains('hero-action')) button.querySelector('b').textContent = OpenScreenI18n.t('Đang bắt đầu…');
  OpenScreen.toast(OpenScreenI18n.t(button.dataset.action === 'CAPTURE_FULL_PAGE' ? 'Đang cuộn và ghép toàn trang…' : 'Đang xử lý ảnh chụp…'));
  await saveSettings();
  const response = await chrome.runtime.sendMessage({ type: button.dataset.action });
  if (!response?.ok) { button.disabled = false; button.innerHTML = button.dataset.originalLabel; OpenScreen.toast(response?.error || OpenScreenI18n.t('Không thể thực hiện.')); }
  else window.close();
}));

$('.delay-action').addEventListener('click', async event => {
  if (event.target.closest('select')) return;
  const delay = Number($('#delay').value);
  await saveSettings();
  const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE', delay });
  if (!response?.ok) OpenScreen.toast(response?.error || OpenScreenI18n.t('Không thể chụp hẹn giờ.')); else window.close();
});

$$('.source').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: 'OPEN_RECORDER', mode: button.dataset.mode });
  if (!response?.ok) { button.disabled = false; OpenScreen.toast(response?.error || OpenScreenI18n.t('Không thể mở Studio quay.')); return; }
  window.close();
}));
$('#library').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'OPEN_LIBRARY' }); window.close(); });
$('#settings').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }); window.close(); });
$('#feedback').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
$('#importImage').addEventListener('click',()=>$('#imageFile').click());
$('#imageFile').addEventListener('change',async()=>{const file=$('#imageFile').files[0];if(!file)return;const bitmap=await createImageBitmap(file);const id=OpenScreen.uid('shot');await OpenScreenDB.saveDraft({id,kind:'image',name:file.name.replace(/\.[^.]+$/,''),createdAt:Date.now(),width:bitmap.width,height:bitmap.height,mimeType:file.type,blob:file});await chrome.tabs.create({url:chrome.runtime.getURL(`editor/editor.html?id=${encodeURIComponent(id)}`)});window.close()});
[$('#openEditor'),$('#autoCopyAfterCapture'),$('#delay')].forEach(element => element.addEventListener('change', saveSettings));

async function saveSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  Object.assign(settings, {
    openEditor: $('#openEditor').checked,
    autoCopyAfterCapture: $('#autoCopyAfterCapture').checked,
    delay: Number($('#delay').value)
  });
  await chrome.storage.local.set({ settings });
}
