const port = process.argv[2] || '9333';
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
const target = targets.reverse().find(item => item.url.includes('chrome-extension://haiccdfjiojeffojibnacpdibmdjelgo/'));
if (!target) throw new Error('OpenScreen extension target not found');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const exceptions = [];
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') exceptions.push(message.params.entry.text);
};
function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.text}: ${result.exceptionDetails.exception?.description || 'no description'}`);
  return result.result.value;
}
async function navigate(path) {
  await send('Page.navigate', { url: `chrome-extension://haiccdfjiojeffojibnacpdibmdjelgo/${path}` });
  await new Promise(resolve => setTimeout(resolve, 700));
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
const probe = await evaluate('({title:document.title,text:document.body.innerText.slice(0,160),runtime:typeof chrome?.runtime})');
if (probe.runtime !== 'object') throw new Error(`Extension runtime unavailable: ${JSON.stringify(probe)}`);
const manifest = JSON.parse(await evaluate('JSON.stringify(chrome.runtime.getManifest())'));
if (manifest.name !== 'OpenScreen Studio') throw new Error('Unexpected manifest');

await navigate('popup/popup.html');
const popup = await evaluate('({cards:document.querySelectorAll(".action-card").length,tabs:document.querySelectorAll(".tab").length,height:document.body.scrollHeight})');
if (popup.cards !== 4 || popup.tabs !== 2) throw new Error(`Popup smoke check failed: ${JSON.stringify(popup)}`);

await navigate('recorder/recorder.html?mode=screen');
const recorder = await evaluate('({hasPreview:!!document.querySelector("#preview"),resolutions:document.querySelectorAll("#resolution option").length,mediaRecorder:typeof MediaRecorder})');
if (!recorder.hasPreview || recorder.resolutions !== 4 || recorder.mediaRecorder !== 'function') throw new Error(`Recorder smoke check failed: ${JSON.stringify(recorder)}`);

await navigate('library/library.html');
const library = await evaluate('({hasGrid:!!document.querySelector("#grid"),hasIndexedDB:!!window.indexedDB})');
if (!library.hasGrid || !library.hasIndexedDB) throw new Error('Library smoke check failed');

await new Promise(resolve => setTimeout(resolve, 300));
socket.close();
if (exceptions.length) throw new Error(`Runtime errors: ${exceptions.join('; ')}`);
console.log(`CDP smoke passed: ${manifest.name} ${manifest.version}; popup height ${popup.height}px; MediaRecorder available.`);
