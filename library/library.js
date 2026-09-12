const grid=document.querySelector('#grid'),template=document.querySelector('#itemTemplate');
const requestedFilter=new URLSearchParams(location.search).get('filter');
let items=[],filter=['all','image','video'].includes(requestedFilter)?requestedFilter:'all',urls=[];

init();
async function init(){await OpenScreenI18n.ready;await load()}
async function load(){items=await OpenScreenDB.list();render();updateStats();updateStorage()}
function render(){
  urls.forEach(URL.revokeObjectURL);urls=[];grid.innerHTML='';
  const q=document.querySelector('#search').value.trim().toLowerCase(),latestOpenedId=items.reduce((latest,item)=>!latest||Number(item.lastOpenedAt||0)>Number(latest.lastOpenedAt||0)?item:latest,null)?.id;
  const visible=items.filter(i=>(filter==='all'||i.kind===filter)&&(!q||i.name.toLowerCase().includes(q)));
  document.querySelector('#empty').classList.toggle('hidden',visible.length>0);
  for(const item of visible){
    const node=template.content.cloneNode(true),card=node.querySelector('.media-card'),url=URL.createObjectURL(item.blob);urls.push(url);
    const img=node.querySelector('img'),video=node.querySelector('video');if(item.kind==='image'){img.src=url;video.remove()}else{video.src=url;img.remove()}
    const recentlyOpened=item.id===latestOpenedId;card.classList.toggle('recently-opened',recentlyOpened);node.querySelector('.opened-badge').classList.toggle('hidden',!recentlyOpened);
    node.querySelector('.kind').textContent=item.kind==='image'?OpenScreenI18n.t('ẢNH'):'VIDEO';
    const duration=node.querySelector('.duration');duration.textContent=item.kind==='video'?OpenScreen.formatDuration(item.duration):`${item.width}×${item.height}`;
    const name=node.querySelector('.item-name');name.value=item.name;name.addEventListener('change',async()=>{await OpenScreenDB.rename(item.id,name.value.trim()||item.name);item.name=name.value});
    node.querySelector('.meta').textContent=`${new Date(item.createdAt).toLocaleString(OpenScreenI18n.locale)} • ${OpenScreen.formatBytes(item.blob.size)}`;
    node.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>handle(button.dataset.action,item,url)));card.dataset.id=item.id;grid.append(node);
  }
}
async function handle(action,item,url){
  if(action==='open'){await OpenScreenDB.markOpened(item.id);item.lastOpenedAt=Date.now();render();const returnFilter=`&fromFilter=${encodeURIComponent(filter)}&fromLibrary=1`,target=item.kind==='image'?chrome.runtime.getURL(`editor/editor.html?id=${encodeURIComponent(item.id)}${returnFilter}`):chrome.runtime.getURL(`video-editor/video-editor.html?id=${encodeURIComponent(item.id)}${returnFilter}`);try{await chrome.tabs.create({url:target})}catch{window.open(target,'_blank')}}
  if(action==='download'){const a=document.createElement('a');a.href=url;a.download=`${item.name.replace(/[\\/:*?"<>|]/g,'-')}.${item.kind==='image'?'png':(item.extension||'webm')}`;a.click()}
  if(action==='delete'){if(!confirm(OpenScreenI18n.t('Xóa “{name}”? Thao tác này không thể hoàn tác.',{name:item.name})))return;await OpenScreenDB.remove(item.id);items=items.filter(i=>i.id!==item.id);render();updateStats();updateStorage()}
}
function updateStats(){document.querySelector('#imageCount').textContent=items.filter(i=>i.kind==='image').length;document.querySelector('#videoCount').textContent=items.filter(i=>i.kind==='video').length}
async function updateStorage(){const estimate=await navigator.storage?.estimate?.();const used=estimate?.usage||items.reduce((n,i)=>n+(i.blob?.size||0),0),quota=estimate?.quota||0;document.querySelector('#storageText').textContent=quota?`${OpenScreen.formatBytes(used)} / ${OpenScreen.formatBytes(quota)}`:OpenScreen.formatBytes(used);document.querySelector('#storageBar').style.width=quota?`${Math.min(100,used/quota*100)}%`:'0'}
document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;history.replaceState(null,'',`?filter=${encodeURIComponent(filter)}`);document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render()}));document.querySelector('#search').addEventListener('input',render);document.querySelector('#settings').addEventListener('click',()=>chrome.runtime.openOptionsPage());document.querySelector('#capture').addEventListener('click',()=>location.href=chrome.runtime.getURL('welcome/welcome.html#start'));document.querySelector('#emptyCreate').addEventListener('click',()=>location.href=chrome.runtime.getURL('welcome/welcome.html#start'));window.addEventListener('unload',()=>urls.forEach(URL.revokeObjectURL));
