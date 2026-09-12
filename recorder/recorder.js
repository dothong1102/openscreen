const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const canvas = $('#preview');
const ctx = canvas.getContext('2d');
const query = new URLSearchParams(location.search);
let mode = query.get('mode') === 'camera' ? 'camera' : 'screen';
let displayStream, userStream, audioContext, outputStream, mediaRecorder;
let screenVideo, cameraVideo, renderFrame, chunks = [], startedAt = 0, pausedAt = 0, totalPaused = 0, timerInterval;
let recordingBlob, recordingId, recordingExt = 'webm', recordingMime = 'video/webm';
let annotations = [], currentStroke = null, annotationTool = 'none', nextAnnotationNumber = 1;
let stopping = false;
let micTestStream, micTestContext, micTestFrame;
let audioAnalyser, audioMeterFrame;

init();
async function init(){
  await OpenScreenI18n.ready;
  const {settings={}}=await chrome.storage.local.get('settings');
  ['microphone','camera','systemAudio'].forEach(key=>{if(typeof settings[key]==='boolean')$(`#${key}`).checked=settings[key]});
  ['resolution','fps','bitrate','format','countdown'].forEach(key=>{if(settings[key]!=null&&$(`#${key}`))$(`#${key}`).value=String(settings[key])});
  setMode(mode);
  if($('#microphone').checked){$('#micDeviceRow').classList.remove('hidden');await populateMicrophones(settings.microphoneDeviceId);try{await startMicrophoneTest()}catch(error){$('#micTestStatus').textContent=OpenScreenI18n.t('Chưa thể kiểm tra')}}
  await populateCameras(settings.cameraDeviceId);
}
async function populateMicrophones(preferredId=''){
  const select=$('#micDevice'),hint=$('#micDeviceHint');
  const devices=(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==='audioinput');
  const selected=preferredId||select.value;
  select.replaceChildren();
  if(!devices.length){select.append(new Option(OpenScreenI18n.t('Không tìm thấy microphone'),''));select.disabled=true;hint.textContent=OpenScreenI18n.t('Chrome chưa tìm thấy thiết bị thu âm.');$('#micTestStatus').textContent=OpenScreenI18n.t('Không có microphone');return}
  devices.forEach((device,index)=>select.append(new Option(device.label||`Microphone ${index+1}`,device.deviceId)));
  select.disabled=false;
  select.value=devices.some(device=>device.deviceId===selected)?selected:devices[0].deviceId;
  hint.textContent=`${OpenScreenI18n.t('Đang chọn:')} ${select.selectedOptions[0]?.textContent||OpenScreenI18n.t('Microphone mặc định')}`;
}
async function stopMicrophoneTest(){
  cancelAnimationFrame(micTestFrame);micTestFrame=0;
  micTestStream?.getTracks().forEach(track=>track.stop());micTestStream=null;
  const context=micTestContext;micTestContext=null;
  if(context&&context.state!=='closed')await context.close().catch(()=>{});
  $('#micLevel').style.width='0%';
}
async function startMicrophoneTest(){
  await stopMicrophoneTest();
  const deviceId=$('#micDevice').value;
  if(!$('#microphone').checked||!deviceId||$('#micDevice').disabled)return;
  try{const status=$('#micTestStatus');status.textContent=OpenScreenI18n.t('Đang lắng nghe…');
    micTestStream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:deviceId},echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    micTestContext=new AudioContext();await micTestContext.resume();
    const analyser=micTestContext.createAnalyser();analyser.fftSize=512;const samples=new Uint8Array(analyser.fftSize);
    micTestContext.createMediaStreamSource(micTestStream).connect(analyser);
    const update=()=>{if(!micTestStream)return;analyser.getByteTimeDomainData(samples);let sum=0;for(const sample of samples){const value=(sample-128)/128;sum+=value*value}const level=Math.min(1,Math.sqrt(sum/samples.length)*6);$('#micLevel').style.width=`${Math.max(2,level*100)}%`;status.textContent=OpenScreenI18n.t(level>.045?'Đang nhận âm thanh':'Đang lắng nghe…');micTestFrame=requestAnimationFrame(update)};
    update();
  }catch(error){await stopMicrophoneTest();throw error}
}
async function onMicrophoneChange(){
  const enabled=$('#microphone').checked;
  if(!enabled){await stopMicrophoneTest();$('#micDeviceRow').classList.add('hidden');await persistSettings();return}
  try{
    const permissionStream=await navigator.mediaDevices.getUserMedia({audio:true});
    permissionStream.getTracks().forEach(track=>track.stop());
    $('#micDeviceRow').classList.remove('hidden');
    const {settings={}}=await chrome.storage.local.get('settings');
    await populateMicrophones(settings.microphoneDeviceId);
    await startMicrophoneTest();
    await persistSettings();
  }catch(error){await stopMicrophoneTest();$('#micDevice').disabled=true;$('#micDeviceRow').classList.remove('hidden');$('#micDeviceHint').textContent='Chưa có microphone khả dụng — video sẽ không thu âm từ mic.';$('#micTestStatus').textContent='Chưa thể kiểm tra';await persistSettings();OpenScreen.toast('Chưa thể dùng microphone. Video sẽ quay mà không có tiếng mic cho đến khi chọn thiết bị hợp lệ.');}
}
async function populateCameras(preferredId=''){
  const select=$('#cameraDevice'),hint=$('#cameraDeviceHint');
  const devices=(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==='videoinput');
  const selected=preferredId||select.value;
  select.replaceChildren();
  if(!devices.length){select.append(new Option('Không tìm thấy camera',''));select.disabled=true;$('#camera').disabled=false;setCameraTabAvailable(false);hint.textContent='Chưa có camera khả dụng — video sẽ không dùng Camera nổi.';return false}
  devices.forEach((device,index)=>select.append(new Option(device.label||`Camera ${index+1}`,device.deviceId)));
  select.disabled=false;$('#camera').disabled=false;setCameraTabAvailable(true);
  select.value=devices.some(device=>device.deviceId===selected)?selected:devices[0].deviceId;
  hint.textContent=`Đang chọn: ${select.selectedOptions[0]?.textContent||'Camera mặc định'}`;
  return true;
}
async function onCameraChange(){
  const enabled=$('#camera').checked;
  if(!enabled){$('#cameraDeviceRow').classList.toggle('hidden',mode!=='camera');await persistSettings();return}
  try{
    const permissionStream=await navigator.mediaDevices.getUserMedia({video:true});
    permissionStream.getTracks().forEach(track=>track.stop());
    $('#cameraDeviceRow').classList.remove('hidden');
    const {settings={}}=await chrome.storage.local.get('settings');
    if(!await populateCameras(settings.cameraDeviceId))throw new Error('Không tìm thấy camera.');
    await persistSettings();
  }catch(error){$('#cameraDevice').disabled=true;$('#cameraDeviceRow').classList.remove('hidden');$('#cameraDeviceHint').textContent='Chưa có camera khả dụng — video sẽ không dùng Camera nổi.';await persistSettings();OpenScreen.toast('Chưa thể dùng camera. Video màn hình vẫn quay bình thường.');}
}
function setMode(next){mode=next;$$('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$('#cameraRow').classList.toggle('hidden',mode==='camera');$('#systemRow').classList.toggle('hidden',mode==='camera');$('#cameraDeviceRow').classList.toggle('hidden',mode!=='camera'&&!$('#camera').checked)}
function setCameraTabAvailable(available){const button=$('[data-mode="camera"]');button.disabled=false;button.title=available?'Quay từ camera':'Chưa tìm thấy camera — kết nối thiết bị để quay'}
async function selectCameraMode(){
  setMode('camera');
  try{const permissionStream=await navigator.mediaDevices.getUserMedia({video:true});permissionStream.getTracks().forEach(track=>track.stop());const {settings={}}=await chrome.storage.local.get('settings');await populateCameras(settings.cameraDeviceId)}
  catch(error){$('#cameraDevice').disabled=true;$('#cameraDeviceHint').textContent='Chưa có camera khả dụng — hãy kết nối camera để quay.';OpenScreen.toast('Chưa tìm thấy camera. Bạn vẫn có thể ở tab này để kết nối hoặc cấp quyền rồi thử lại.')}
}
$$('[data-mode]').forEach(button=>button.addEventListener('click',async()=>{if(button.dataset.mode==='camera')await selectCameraMode();else setMode('screen')}));
$('#start').addEventListener('click',startRecording);
$('#stop').addEventListener('click',stopRecording);
$('#pause').addEventListener('click',togglePause);
$('#micToggle').addEventListener('click',()=>toggleTracks('audio',$('#micToggle')));
$('#camToggle').addEventListener('click',()=>toggleTracks('video',$('#camToggle'),userStream));
$('#microphone').addEventListener('change',onMicrophoneChange);
$('#micDevice').addEventListener('change',async()=>{try{await startMicrophoneTest();$('#micDeviceHint').textContent=`Đang chọn: ${$('#micDevice').selectedOptions[0]?.textContent||'Microphone mặc định'}`}catch(error){$('#micTestStatus').textContent='Không thể kiểm tra microphone';OpenScreen.toast('Không thể mở microphone này. Hãy chọn thiết bị khác.')}await persistSettings()});
$('#camera').addEventListener('change',onCameraChange);
$('#cameraDevice').addEventListener('change',async()=>{$('#cameraDeviceHint').textContent=`Đang chọn: ${$('#cameraDevice').selectedOptions[0]?.textContent||'Camera mặc định'}`;await persistSettings()});
$('#clearDraw').addEventListener('click',()=>{annotations=[];nextAnnotationNumber=1});
$('#snapshot').addEventListener('click',snapshot);
$('#download').addEventListener('click',()=>downloadBlob(recordingBlob,`OpenScreen-${new Date().toISOString().replace(/[:.]/g,'-')}.${recordingExt}`));
$('#editVideo').addEventListener('click',()=>location.href=chrome.runtime.getURL(`video-editor/video-editor.html?id=${encodeURIComponent(recordingId)}`));
$('#shareVideo').addEventListener('click',async()=>{const file=new File([recordingBlob],`OpenScreen.${recordingExt}`,{type:recordingMime});if(navigator.canShare?.({files:[file]}))await navigator.share({title:'OpenScreen recording',files:[file]});else OpenScreen.toast('Thiết bị này không hỗ trợ chia sẻ tệp video trực tiếp.')});
$('#newRecording').addEventListener('click',()=>location.reload());
$('#library').addEventListener('click',()=>location.href=chrome.runtime.getURL('library/library.html'));
$$('.annotate').forEach(button=>button.addEventListener('click',()=>{annotationTool=button.dataset.tool;$$('.annotate').forEach(b=>b.classList.toggle('active',b===button));canvas.style.cursor=annotationTool==='none'?'default':'crosshair';}));

async function startRecording(){
  $('#start').disabled=true;stopping=false;annotations=[];nextAnnotationNumber=1;chunks=[];
  await stopMicrophoneTest();
  const height=Number($('#resolution').value),width=Math.round(height*16/9),fps=Number($('#fps').value);
  try{
    if(mode==='screen') displayStream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:width},height:{ideal:height},frameRate:{ideal:fps,max:fps}},audio:$('#systemAudio').checked,selfBrowserSurface:'exclude',surfaceSwitching:'include',systemAudio:'include'});
    const wantsCamera=mode==='camera'||$('#camera').checked,wantsMic=$('#microphone').checked;
    const micDeviceId=$('#micDevice').value,cameraDeviceId=$('#cameraDevice').value;
    const useMic=wantsMic&&!$('#micDevice').disabled&&Boolean(micDeviceId),useCamera=wantsCamera&&!$('#cameraDevice').disabled&&Boolean(cameraDeviceId);
    if(mode==='camera'&&!useCamera)throw new Error('Hãy chọn một camera khả dụng trước khi quay bằng Camera.');
    if(useCamera||useMic) userStream=await navigator.mediaDevices.getUserMedia({video:useCamera?{deviceId:{exact:cameraDeviceId},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:fps}}:false,audio:useMic?{deviceId:{exact:micDeviceId},echoCancellation:true,noiseSuppression:true,autoGainControl:true}:false});
    screenVideo=await videoFor(displayStream);cameraVideo=await videoFor(userStream?.getVideoTracks().length?new MediaStream(userStream.getVideoTracks()):null);
    const sourceTrack=(displayStream||userStream).getVideoTracks()[0],settings=sourceTrack.getSettings();
    const aspect=settings.width&&settings.height?settings.width/settings.height:16/9;
    canvas.height=height;canvas.width=Math.round(height*aspect);if(canvas.width>width){canvas.width=width;canvas.height=Math.round(width/aspect)}
    render();
    const canvasStream=canvas.captureStream(fps);outputStream=new MediaStream(canvasStream.getVideoTracks());
    await mixAudio([displayStream,userStream].filter(Boolean),outputStream);
    const requested=$('#format').value;recordingMime=chooseMime(requested);recordingExt=recordingMime.startsWith('video/mp4')?'mp4':'webm';
    mediaRecorder=new MediaRecorder(outputStream,{mimeType:recordingMime,videoBitsPerSecond:Number($('#bitrate').value)*1_000_000,audioBitsPerSecond:192_000});
    // Keep MediaRecorder chunks in memory until stop. OPFS writes can remain pending
    // on some Chrome builds, leaving the recorder permanently at “finalizing”.
    mediaRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};mediaRecorder.onstop=()=>{void finalizeRecording()};mediaRecorder.onerror=e=>fail(e.error||new Error('MediaRecorder error'));
    displayStream?.getVideoTracks()[0].addEventListener('ended',()=>{if(mediaRecorder?.state!=='inactive')stopRecording()},{once:true});
    $('#empty').classList.add('hidden');await countdown(Number($('#countdown').value));
    mediaRecorder.start(1000);startedAt=Date.now();timerInterval=setInterval(updateTimer,250);
    $('#setup').classList.add('hidden');$('.layout').classList.add('recording-layout');$('#controls').classList.remove('hidden');$('.header-status').classList.add('recording');$('#status').textContent=`Đang quay ${recordingExt.toUpperCase()} • ${canvas.width}×${canvas.height}`;
    await persistSettings();
  }catch(error){cleanupStreams();$('.layout').classList.remove('recording-layout');$('#start').disabled=false;if(error.name!=='NotAllowedError')fail(error);else OpenScreen.toast('Bạn đã hủy chọn nguồn hoặc quyền camera/mic.');}
}
async function videoFor(stream){if(!stream)return null;const v=document.createElement('video');v.srcObject=stream;v.muted=true;v.playsInline=true;await v.play();return v;}
function chooseMime(requested){const options=requested==='mp4'?['video/mp4;codecs=avc1.42E01E,opus','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus']:['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];return options.find(type=>MediaRecorder.isTypeSupported(type))||'';}
async function mixAudio(streams,target){const tracks=streams.flatMap(s=>s.getAudioTracks());if(!tracks.length){stopAudioMeter();return}audioContext=new AudioContext();await audioContext.resume().catch(()=>{});const dest=audioContext.createMediaStreamDestination();audioAnalyser=audioContext.createAnalyser();audioAnalyser.fftSize=512;for(const track of tracks){const source=audioContext.createMediaStreamSource(new MediaStream([track]));source.connect(dest);source.connect(audioAnalyser)}dest.stream.getAudioTracks().forEach(t=>target.addTrack(t));startAudioMeter();}
function startAudioMeter(){if(!audioAnalyser)return;const meter=$('#audioMeter'),levelEl=$('#audioLevel'),status=$('#audioStatus'),samples=new Uint8Array(audioAnalyser.fftSize);meter.classList.remove('hidden');const update=()=>{if(!audioAnalyser)return;audioAnalyser.getByteTimeDomainData(samples);let sum=0;for(const sample of samples){const value=(sample-128)/128;sum+=value*value}const level=Math.min(1,Math.sqrt(sum/samples.length)*6);levelEl.style.width=`${Math.max(2,level*100)}%`;status.textContent=`${Math.round(level*100)}%`;audioMeterFrame=requestAnimationFrame(update)};update()}
function stopAudioMeter(){cancelAnimationFrame(audioMeterFrame);audioMeterFrame=0;audioAnalyser=null;$('#audioLevel').style.width='0%';$('#audioStatus').textContent='Âm lượng';$('#audioMeter').classList.add('hidden')}
function render(){
  ctx.fillStyle='#101522';ctx.fillRect(0,0,canvas.width,canvas.height);
  const main=mode==='camera'?cameraVideo:screenVideo;if(main?.readyState>=2)drawContain(main,0,0,canvas.width,canvas.height);
  if(mode==='screen'&&cameraVideo&&userStream?.getVideoTracks()[0]?.enabled){const size=Math.round(canvas.height*.23),margin=Math.round(canvas.height*.035),x=canvas.width-size-margin,y=canvas.height-size-margin;ctx.save();ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);ctx.clip();ctx.translate(x+size,y);ctx.scale(-1,1);ctx.drawImage(cameraVideo,0,0,size,size);ctx.restore();ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(4,canvas.height*.006);ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);ctx.stroke();}
  drawAnnotations();renderFrame=requestAnimationFrame(render);
}
function drawContain(video,x,y,w,h){const vw=video.videoWidth||w,vh=video.videoHeight||h,s=Math.min(w/vw,h/vh),dw=vw*s,dh=vh*s;ctx.drawImage(video,x+(w-dw)/2,y+(h-dh)/2,dw,dh);}
function drawAnnotations(){for(const a of annotations){ctx.save();ctx.strokeStyle=a.color;ctx.fillStyle=a.color;ctx.lineWidth=Math.max(3,canvas.height*.006);ctx.lineCap='round';ctx.lineJoin='round';if(a.tool==='pen'){ctx.beginPath();a.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke()}if(a.tool==='arrow'){const p=a.points[0],q=a.points.at(-1);if(p&&q){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();const angle=Math.atan2(q.y-p.y,q.x-p.x),head=canvas.height*.035;ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-head*Math.cos(angle-.5),q.y-head*Math.sin(angle-.5));ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-head*Math.cos(angle+.5),q.y-head*Math.sin(angle+.5));ctx.stroke()}}if(a.tool==='spotlight'){const p=a.points.at(-1);if(p){ctx.globalCompositeOperation='screen';const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,canvas.height*.1);g.addColorStop(0,'rgba(255,245,120,.85)');g.addColorStop(1,'rgba(255,245,120,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,canvas.height*.1,0,Math.PI*2);ctx.fill()}}if(a.tool==='number'){const p=a.points[0],radius=Math.max(17,canvas.height*.026);if(p){ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(2,radius*.12);ctx.stroke();ctx.fillStyle='#fff';ctx.font=`800 ${Math.max(14,radius*(a.number>9?.78:1.05))}px Inter, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(a.number),p.x,p.y+1)}}ctx.restore()}}
function canvasPoint(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}}
canvas.addEventListener('pointerdown',e=>{if(annotationTool==='none'||!mediaRecorder)return;const point=canvasPoint(e);if(annotationTool==='number'){annotations.push({tool:'number',color:$('#drawColor').value,number:nextAnnotationNumber++,points:[point]});return}currentStroke={tool:annotationTool,color:$('#drawColor').value,points:[point]};annotations.push(currentStroke);canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(currentStroke)currentStroke.points.push(canvasPoint(e))});canvas.addEventListener('pointerup',()=>currentStroke=null);
async function countdown(seconds){if(!seconds)return;$('#countdownOverlay').classList.remove('hidden');for(let n=seconds;n>0;n--){$('#countdownOverlay').textContent=n;await new Promise(r=>setTimeout(r,1000))}$('#countdownOverlay').classList.add('hidden')}
function updateTimer(){const elapsed=Date.now()-startedAt-totalPaused-(pausedAt?Date.now()-pausedAt:0);$('#timer').textContent=OpenScreen.formatDuration(elapsed)}
function togglePause(){if(!mediaRecorder)return;if(mediaRecorder.state==='recording'){mediaRecorder.pause();pausedAt=Date.now();$('#pause').textContent='▶';$('#status').textContent='Đã tạm dừng'}else if(mediaRecorder.state==='paused'){mediaRecorder.resume();totalPaused+=Date.now()-pausedAt;pausedAt=0;$('#pause').textContent='Ⅱ';$('#status').textContent='Đang quay'}}
function toggleTracks(kind,button,stream=userStream){const tracks=stream?.getTracks().filter(t=>t.kind===kind)||[];const enabled=!tracks.every(t=>t.enabled);tracks.forEach(t=>t.enabled=enabled);button.classList.toggle('active',enabled);button.style.opacity=enabled?'1':'.45'}
function stopRecording(){if(stopping||!mediaRecorder||mediaRecorder.state==='inactive')return;stopping=true;if(mediaRecorder.state==='paused')mediaRecorder.resume();try{mediaRecorder.requestData()}catch{}mediaRecorder.stop();clearInterval(timerInterval);cancelAnimationFrame(renderFrame);$('#stop').disabled=true;$('#pause').disabled=true;$('#status').textContent='Đang hoàn tất tệp…'}
async function collectRecordingBlob(){
  if(!chunks.length)throw new Error('Không nhận được dữ liệu video. Hãy quay lại và thử chọn một nguồn khác.');
  return new Blob(chunks,{type:recordingMime});
}
async function finalizeRecording(){try{const duration=Date.now()-startedAt-totalPaused;recordingBlob=await collectRecordingBlob();$('#status').textContent='Đang lưu bản ghi…';recordingId=OpenScreen.uid('recording');await OpenScreenDB.save({id:recordingId,kind:'video',name:`Recording ${new Date().toLocaleString('vi-VN')}`,createdAt:Date.now(),duration,width:canvas.width,height:canvas.height,mimeType:recordingMime,extension:recordingExt,blob:recordingBlob});const url=URL.createObjectURL(recordingBlob);$('#playback').src=url;$('#resultMeta').textContent=`${OpenScreen.formatDuration(duration)} • ${canvas.width}×${canvas.height} • ${OpenScreen.formatBytes(recordingBlob.size)} • ${recordingExt.toUpperCase()}`;$('.stage-area').classList.add('done');$('#result').classList.remove('hidden');$('.header-status').classList.remove('recording');$('#status').textContent='Bản ghi đã sẵn sàng';cleanupStreams()}catch(error){cleanupStreams();fail(error)}}
function cleanupStreams(){stopAudioMeter();[displayStream,userStream,outputStream].forEach(s=>s?.getTracks().forEach(t=>t.stop()));audioContext?.close().catch(()=>{})}
function fail(error){console.error(error);OpenScreen.toast(`Lỗi: ${error.message}`);$('#status').textContent='Có lỗi xảy ra'}
async function snapshot(){
  const button=$('#snapshot');button.disabled=true;
  try{const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Không thể tạo ảnh từ khung hình hiện tại.');const id=OpenScreen.uid('frame');await OpenScreenDB.save({id,kind:'image',name:`Khung hình — ${new Date().toLocaleString('vi-VN')}`,createdAt:Date.now(),width:canvas.width,height:canvas.height,mimeType:'image/png',blob});OpenScreen.toast('Đã lưu khung hình vào Thư viện.');}
  catch(error){console.error(error);OpenScreen.toast('Không thể lưu khung hình. Hãy thử lại.')}
  finally{button.disabled=false}
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
async function persistSettings(){const {settings={}}=await chrome.storage.local.get('settings');Object.assign(settings,{microphone:$('#microphone').checked,microphoneDeviceId:$('#micDevice').value||'',camera:$('#camera').checked,cameraDeviceId:$('#cameraDevice').value||'',systemAudio:$('#systemAudio').checked,resolution:$('#resolution').value,fps:Number($('#fps').value),bitrate:Number($('#bitrate').value),format:$('#format').value,countdown:Number($('#countdown').value)});await chrome.storage.local.set({settings})}
window.addEventListener('beforeunload',e=>{if(mediaRecorder&&mediaRecorder.state!=='inactive'){e.preventDefault();e.returnValue=''}});window.addEventListener('unload',()=>{void stopMicrophoneTest()});
