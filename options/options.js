const ids=['language','imageFormat','delay','resolution','fps','bitrate','countdown'];
init();

async function init(){
  await OpenScreenI18n.ready;
  document.querySelector('#version').textContent=chrome.runtime.getManifest().version;
  const projectLink=document.querySelector('.project-link');
  if(projectLink?.lastChild)projectLink.lastChild.nodeValue=` ${OpenScreenI18n.language==='en'?'View source on GitHub':'Xem mã nguồn trên GitHub'}`;
  const{settings={}}=await chrome.storage.local.get('settings');
  ids.forEach(id=>{if(settings[id]!=null)document.querySelector(`#${id}`).value=String(settings[id])});
}

document.querySelector('#save').addEventListener('click',async()=>{
  const{settings={}}=await chrome.storage.local.get('settings');
  ids.forEach(id=>settings[id]=['delay','fps','bitrate','countdown'].includes(id)?Number(document.querySelector(`#${id}`).value):document.querySelector(`#${id}`).value);
  await chrome.storage.local.set({settings});
  await OpenScreenI18n.setLanguage(settings.language);
  OpenScreen.toast(OpenScreenI18n.t('Đã lưu cài đặt'));
});

document.querySelector('#clear').addEventListener('click',async()=>{
  if(!confirm(OpenScreenI18n.t('Xóa vĩnh viễn toàn bộ ảnh và video trong thư viện cục bộ?')))return;
  const items=await OpenScreenDB.list();
  for(const item of items)await OpenScreenDB.remove(item.id);
  OpenScreen.toast(OpenScreenI18n.t('Đã xóa toàn bộ thư viện'));
});
