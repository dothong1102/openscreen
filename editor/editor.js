const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const wrap = document.querySelector('.canvas-wrap');
const workspace = document.querySelector('#workspace');
const params = new URLSearchParams(location.search);
const itemId = params.get('id');
const autoCopyAfterCapture = params.get('copy') === '1';
const returnLibraryFilter = ['all','image','video'].includes(params.get('fromFilter')) ? params.get('fromFilter') : 'all';
const openedFromLibrary = params.get('fromLibrary') === '1';
let record;
let tool = 'select';
let zoom = 1;
let drawing = false;
let start = null;
let last = null;
let previewCanvas = document.createElement('canvas');
let history = [];
let future = [];
let historyPending = 0;
let historyMoving = false;
let panning = false;
let panStart = null;
let nextMarkerNumber = 1;

init();
async function init() {
  await OpenScreenI18n.ready;
  record = await OpenScreenDB.get(itemId);
  if (!record?.blob) { document.querySelector('#loading').innerHTML = `<b>${OpenScreenI18n.t('Không tìm thấy ảnh.')}</b>`; return; }
  if (openedFromLibrary || record.savedToLibrary === true) document.querySelector('#save').classList.add('hidden');
  document.querySelector('#name').value = record.name || 'Screenshot';
  const image = await createImageBitmap(record.blob);
  canvas.width = image.width; canvas.height = image.height;
  ctx.drawImage(image, 0, 0);
  syncPreview();
  canvas.style.cursor = 'grab';
  document.querySelector('#loading').classList.add('hidden');
  setTimeout(fitCanvas, 50);
  if (autoCopyAfterCapture) setTimeout(() => copyImage({ automatic: true }), 160);
}

document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => {
  tool = button.dataset.tool;
  document.querySelectorAll('[data-tool]').forEach(el => el.classList.toggle('active', el === button));
  canvas.style.cursor = tool === 'select' ? 'grab' : tool === 'text' ? 'text' : 'crosshair';
}));
document.querySelector('#width').addEventListener('input', event => document.querySelector('#widthValue').textContent = event.target.value);
document.querySelector('#zoomIn').addEventListener('click', () => setZoom(zoom + .1));
document.querySelector('#zoomOut').addEventListener('click', () => setZoom(zoom - .1));
document.querySelector('#fit').addEventListener('click', fitCanvas);
document.querySelector('#undo').addEventListener('click', undo);
document.querySelector('#redo').addEventListener('click', redo);
document.querySelector('#library').addEventListener('click', () => { location.href = chrome.runtime.getURL(`library/library.html?filter=${encodeURIComponent(returnLibraryFilter)}`); });
document.querySelector('#save').addEventListener('click', saveCurrent);
document.querySelector('#copy').addEventListener('click', copyImage);
document.querySelector('#share').addEventListener('click', shareImage);
document.querySelector('#export').addEventListener('click', event => { event.stopPropagation(); document.querySelector('#exportMenu').classList.toggle('hidden'); });
document.addEventListener('click', () => document.querySelector('#exportMenu').classList.add('hidden'));
document.querySelector('#exportMenu').addEventListener('click', event => { event.stopPropagation(); const button=event.target.closest('[data-format]'); if(button) exportImage(button.dataset.format); });

function setZoom(value) { zoom = Math.max(.1, Math.min(3, value)); wrap.style.transform = `scale(${zoom})`; wrap.style.marginRight = `${canvas.width * (zoom - 1)}px`; wrap.style.marginBottom = `${canvas.height * (zoom - 1)}px`; document.querySelector('#zoomLabel').textContent = `${Math.round(zoom * 100)}%`; }
function fitCanvas() { const availableW=workspace.clientWidth-50, availableH=workspace.clientHeight-50; setZoom(Math.min(1, availableW/canvas.width, availableH/canvas.height)); }
function point(event) { const rect=canvas.getBoundingClientRect(); return { x:(event.clientX-rect.left)*canvas.width/rect.width, y:(event.clientY-rect.top)*canvas.height/rect.height }; }
function color(alpha=1) { const hex=document.querySelector('#color').value; if(alpha===1)return hex; const n=parseInt(hex.slice(1),16); return `rgba(${n>>16},${(n>>8)&255},${n&255},${alpha})`; }
function lineWidth() { return Number(document.querySelector('#width').value); }
function syncPreview() { previewCanvas.width=canvas.width; previewCanvas.height=canvas.height; previewCanvas.getContext('2d').drawImage(canvas,0,0); }
function updateHistoryControls() { const pending=historyPending>0||historyMoving; document.querySelector('#undo').disabled=pending||!history.at(-1)?.blob; document.querySelector('#redo').disabled=pending||!future.at(-1)?.blob; }
function canvasBlob(source=canvas) { return new Promise((resolve,reject)=>source.toBlob(blob=>blob?resolve(blob):reject(new Error('Không thể tạo ảnh cho lịch sử chỉnh sửa.')),'image/png')); }
function savePreview() {
  syncPreview();
  const snapshot=document.createElement('canvas');snapshot.width=canvas.width;snapshot.height=canvas.height;snapshot.getContext('2d').drawImage(canvas,0,0);
  const entry={blob:null,nextMarkerNumber};history.push(entry);if(history.length>20)history.shift();future=[];historyPending+=1;updateHistoryControls();
  snapshot.toBlob(blob=>{if(blob)entry.blob=blob;else history=history.filter(item=>item!==entry);historyPending-=1;updateHistoryControls();},'image/png');
}
function restorePreview() { ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(previewCanvas,0,0); }

canvas.addEventListener('pointerdown', event => {
  if (tool === 'select') {
    panning = true;
    panStart = { x: event.clientX, y: event.clientY, left: workspace.scrollLeft, top: workspace.scrollTop };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
    event.preventDefault();
    return;
  }
  if (tool === 'number') {
    savePreview();
    drawNumberMarker(point(event), nextMarkerNumber);
    nextMarkerNumber += 1;
    return;
  }
  drawing=true;start=last=point(event);canvas.setPointerCapture(event.pointerId);
  if(tool==='text'){drawing=false;const value=prompt(OpenScreenI18n.t('Nhập nội dung:'));if(value){savePreview();addText(start,value);}return;}
  savePreview();
});
canvas.addEventListener('pointermove', event => {
  if (panning && panStart) {
    workspace.scrollLeft = panStart.left - (event.clientX - panStart.x);
    workspace.scrollTop = panStart.top - (event.clientY - panStart.y);
    return;
  }
  if(!drawing)return;const p=point(event);
  if(tool==='pen'||tool==='highlight'){
    ctx.save();ctx.strokeStyle=tool==='highlight'?color(.28):color();ctx.lineWidth=tool==='highlight'?lineWidth()*3:lineWidth();ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.restore();last=p;return;
  }
  restorePreview();drawShape(tool,start,p,true);
});
canvas.addEventListener('pointerup', event => {
  if (panning) {
    panning = false;
    panStart = null;
    canvas.style.cursor = tool === 'select' ? 'grab' : 'crosshair';
    return;
  }
  if(!drawing)return;drawing=false;const end=point(event);
  if(tool==='blur'){restorePreview();pixelate(start,end);}
  else if(tool==='crop'){restorePreview();crop(start,end);}
  else if(!['pen','highlight'].includes(tool)){restorePreview();drawShape(tool,start,end,false);}
});
canvas.addEventListener('pointercancel', () => {
  panning = false;
  panStart = null;
  if (tool === 'select') canvas.style.cursor = 'grab';
});

function drawShape(kind,a,b,preview){
  ctx.save();ctx.strokeStyle=color(preview?.75:1);ctx.fillStyle=color(preview?.12:.08);ctx.lineWidth=lineWidth();ctx.lineCap='round';ctx.lineJoin='round';
  const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(b.x-a.x),h=Math.abs(b.y-a.y);
  if(kind==='line'){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  if(kind==='rect'){ctx.beginPath();ctx.rect(x,y,w,h);ctx.stroke();}
  if(kind==='ellipse'){ctx.beginPath();ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2);ctx.stroke();}
  if(kind==='arrow'){
    const angle=Math.atan2(b.y-a.y,b.x-a.x),head=Math.max(14,lineWidth()*3.2);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-head*Math.cos(angle-Math.PI/6),b.y-head*Math.sin(angle-Math.PI/6));ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-head*Math.cos(angle+Math.PI/6),b.y-head*Math.sin(angle+Math.PI/6));ctx.stroke();
  }
  if(kind==='crop'){ctx.setLineDash([10,7]);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.strokeRect(x,y,w,h);ctx.setLineDash([10,7]);ctx.strokeStyle='#3428d5';ctx.lineWidth=1;ctx.strokeRect(x,y,w,h);}
  if(kind==='blur'){ctx.setLineDash([8,6]);ctx.strokeStyle='#5a50e9';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);}
  ctx.restore();
}

function drawNumberMarker(p, number) {
  const radius = Math.max(16, lineWidth() * 3.2);
  ctx.save();
  ctx.fillStyle = color();
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(2, radius * .12);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.max(14, radius * (number > 9 ? .78 : 1.05))}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), p.x, p.y + 1);
  ctx.restore();
}

function pixelate(a,b){
  const x=Math.max(0,Math.round(Math.min(a.x,b.x))),y=Math.max(0,Math.round(Math.min(a.y,b.y))),w=Math.min(canvas.width-x,Math.round(Math.abs(b.x-a.x))),h=Math.min(canvas.height-y,Math.round(Math.abs(b.y-a.y)));if(w<2||h<2)return;
  const size=Math.max(8,Math.round(lineWidth()*1.5));const data=ctx.getImageData(x,y,w,h);for(let yy=0;yy<h;yy+=size){for(let xx=0;xx<w;xx+=size){const i=((Math.min(h-1,yy+Math.floor(size/2))*w)+Math.min(w-1,xx+Math.floor(size/2)))*4;ctx.fillStyle=`rgb(${data.data[i]},${data.data[i+1]},${data.data[i+2]})`;ctx.fillRect(x+xx,y+yy,Math.min(size,w-xx),Math.min(size,h-yy));}}
}
function crop(a,b){const x=Math.round(Math.min(a.x,b.x)),y=Math.round(Math.min(a.y,b.y)),w=Math.round(Math.abs(b.x-a.x)),h=Math.round(Math.abs(b.y-a.y));if(w<5||h<5)return;const temp=document.createElement('canvas');temp.width=w;temp.height=h;temp.getContext('2d').drawImage(canvas,x,y,w,h,0,0,w,h);canvas.width=w;canvas.height=h;ctx.drawImage(temp,0,0);syncPreview();setTimeout(fitCanvas,20);}
function addText(p,value){ctx.save();ctx.font=`700 ${Math.max(16,lineWidth()*4)}px Inter, sans-serif`;ctx.textBaseline='top';const metrics=ctx.measureText(value);ctx.fillStyle='rgba(255,255,255,.88)';ctx.fillRect(p.x-5,p.y-4,metrics.width+10,Math.max(22,lineWidth()*4+8));ctx.fillStyle=color();ctx.fillText(value,p.x,p.y);ctx.restore();}

async function restoreBlob(blob){const image=await createImageBitmap(blob);canvas.width=image.width;canvas.height=image.height;ctx.drawImage(image,0,0);syncPreview();}
async function undo(){if(historyMoving||historyPending||!history.at(-1)?.blob)return;historyMoving=true;updateHistoryControls();try{const current={blob:await canvasBlob(),nextMarkerNumber};const previous=history.pop();future.push(current);await restoreBlob(previous.blob);nextMarkerNumber=previous.nextMarkerNumber;}finally{historyMoving=false;updateHistoryControls();}}
async function redo(){if(historyMoving||historyPending||!future.at(-1)?.blob)return;historyMoving=true;updateHistoryControls();try{const current={blob:await canvasBlob(),nextMarkerNumber};const next=future.pop();history.push(current);await restoreBlob(next.blob);nextMarkerNumber=next.nextMarkerNumber;}finally{historyMoving=false;updateHistoryControls();}}
async function saveCurrent(){const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));record={...record,name:document.querySelector('#name').value.trim()||'Screenshot',width:canvas.width,height:canvas.height,mimeType:'image/png',blob,updatedAt:Date.now()};await OpenScreenDB.save(record);OpenScreen.toast(OpenScreenI18n.t('Đã lưu vào thư viện'));}
async function copyImage({ automatic = false } = {}){const button=document.querySelector('#copy');const original=button?.textContent;if(button){button.disabled=true;button.textContent=OpenScreenI18n.t(automatic?'Đang tự copy…':'Đang copy…')}try{const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob)throw new Error(OpenScreenI18n.t('Không thể tạo ảnh để sao chép.'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);OpenScreen.toast(OpenScreenI18n.t(automatic?'Đã tự copy ảnh — bạn có thể dán ngay bằng ⌘V / Ctrl+V.':'Đã copy ảnh — bạn có thể dán ngay bằng ⌘V / Ctrl+V.'));return true}catch(error){console.error(error);OpenScreen.toast(OpenScreenI18n.t(automatic?'Chrome chặn tự copy ảnh. Hãy bấm nút Copy ảnh để thử lại.':'Không thể copy ảnh. Hãy cấp quyền clipboard cho Chrome rồi thử lại.'));return false}finally{if(button){button.disabled=false;button.textContent=original}}}
async function shareImage(){const blob=await new Promise(r=>canvas.toBlob(r,'image/png')),file=new File([blob],`${document.querySelector('#name').value||'OpenScreen'}.png`,{type:'image/png'});if(navigator.canShare?.({files:[file]})){await navigator.share({title:record.name,files:[file]})}else{await copyImage()}}

document.addEventListener('paste',async event=>{const item=[...event.clipboardData.items].find(i=>i.type.startsWith('image/'));if(!item)return;const blob=item.getAsFile(),image=await createImageBitmap(blob);savePreview();canvas.width=image.width;canvas.height=image.height;ctx.drawImage(image,0,0);syncPreview();fitCanvas();OpenScreen.toast(OpenScreenI18n.t('Đã dán ảnh từ clipboard'))});

document.addEventListener('keydown',event=>{const target=event.target;if(target?.matches?.('input,textarea,select,[contenteditable="true"]'))return;if(!(event.metaKey||event.ctrlKey)||event.altKey)return;if(event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)void redo();else void undo();}else if(event.key.toLowerCase()==='y'){event.preventDefault();void redo();}});

async function exportImage(format){document.querySelector('#exportMenu').classList.add('hidden');const base=(document.querySelector('#name').value.trim()||'openscreen').replace(/[\\/:*?"<>|]/g,'-');
  if(format==='copy'){await copyImage();return;}
  if(format==='pdf'){const jpg=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.94));downloadBlob(makePdf(new Uint8Array(await jpg.arrayBuffer()),canvas.width,canvas.height),`${base}.pdf`);return;}
  const mime=format==='jpg'?'image/jpeg':'image/png';const blob=await new Promise(r=>canvas.toBlob(r,mime,.94));downloadBlob(blob,`${base}.${format}`);
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function makePdf(jpeg,w,h){const maxW=595,maxH=842,scale=Math.min(maxW/w,maxH/h,1),pw=w*scale,ph=h*scale;const enc=new TextEncoder();const parts=[];const offsets=[0];let length=0;const push=v=>{const b=typeof v==='string'?enc.encode(v):v;parts.push(b);length+=b.length;};push('%PDF-1.4\n');const obj=(n,body)=>{offsets[n]=length;push(`${n} 0 obj\n${body}\nendobj\n`);};obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');obj(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);const content=`q\n${pw} 0 0 ${ph} 0 0 cm\n/Im0 Do\nQ`;obj(4,`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);offsets[5]=length;push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);push(jpeg);push('\nendstream\nendobj\n');const xref=length;push('xref\n0 6\n0000000000 65535 f \n');for(let i=1;i<=5;i++)push(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);return new Blob(parts,{type:'application/pdf'});}
