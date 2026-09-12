import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
const errors=[];
if(manifest.manifest_version!==3)errors.push('manifest_version must be 3');
const paths=[manifest.background?.service_worker,manifest.action?.default_popup,manifest.options_page,...Object.values(manifest.icons||{})].filter(Boolean);
for(const path of paths){try{await access(resolve(root,path))}catch{errors.push(`Missing manifest file: ${path}`)}}
const files=['background.js','popup/popup.js','content/capture.js','offscreen/offscreen.js','capture/capture.js','editor/editor.js','recorder/recorder.js','video-editor/video-editor.js','library/library.js','options/options.js','welcome/welcome.js','shared/db.js','shared/utils.js'];
for(const file of files){const text=await readFile(resolve(root,file),'utf8');if(/https?:\/\//.test(text))errors.push(`Unexpected remote URL in ${file}`);if(/eval\s*\(|new Function\s*\(/.test(text))errors.push(`Unsafe dynamic code in ${file}`)}
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`OpenScreen validation passed: ${files.length} scripts, Manifest V${manifest.manifest_version}.`);
