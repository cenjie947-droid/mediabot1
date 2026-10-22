import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const WIDTH=1080
const HEIGHT=1920
const FPS=30
const FONT=process.env.VIDEO_FONTFILE||'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
const MAX_SCENE_SECONDS=Math.min(30,Math.max(1,Number(process.env.VIDEO_MAX_SCENE_SECONDS||20)))

function tmpDir(){return fs.mkdtemp(path.join(os.tmpdir(),'creator-video-'))}
function extFromUrl(url,fallback='bin'){
  try{const e=path.extname(new URL(url).pathname).toLowerCase().replace('.','');return e&&/^[a-z0-9]{1,6}$/.test(e)?e:fallback}catch{return fallback}
}
async function download(url,file){
  if(!/^https?:\/\//i.test(url)) throw new Error('素材 URL 必须是 http(s)')
  const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(45000)})
  if(!r.ok) throw new Error(`下载素材失败 HTTP ${r.status}`)
  const buf=Buffer.from(await r.arrayBuffer())
  if(buf.length<32) throw new Error('素材文件过小或无效')
  await fs.writeFile(file,buf)
}
function run(args){return new Promise((resolve,reject)=>{const p=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',code=>code===0?resolve({out,err}):reject(new Error(err||`ffmpeg exited ${code}`)))})}
function duration(scene){return Math.min(MAX_SCENE_SECONDS,Math.max(1,Number(scene.duration||4)))}
function safeText(text){return String(text||'').replace(/\r/g,'').slice(0,1000)}
function hasVideoUrl(url){return /\.(mp4|mov|m4v|webm|mkv)(\?|$)/i.test(String(url||''))}
function sceneFilter(textFile){return `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,drawtext=fontfile=${FONT}:textfile=${textFile}:fontcolor=white:fontsize=56:line_spacing=12:box=1:boxcolor=black@0.55:boxborderw=22:x=(w-text_w)/2:y=h-text_h-170`}

async function renderScene(scene,dir,index){
  const d=duration(scene)
  const asset=scene.asset_url||scene.assetUrl||scene.source_url||scene.sourceUrl
  const assetKind=String(scene.kind||scene.asset_kind||'').toLowerCase()
  const media=path.join(dir,`asset-${index}.${extFromUrl(asset,assetKind==='video'?'mp4':'jpg')}`)
  const textFile=path.join(dir,`text-${index}.txt`)
  const out=path.join(dir,`scene-${index}.mp4`)
  await fs.writeFile(textFile,safeText(scene.onscreen_text||scene.onscreenText||''),'utf8')
  const args=[]
  let useAsset=false
  if(asset){
    try{await download(asset,media);useAsset=true}catch(e){console.warn(`scene ${index}: asset unavailable, using fallback background:`,e.message)}
  }
  if(useAsset){
    const isVideo=assetKind==='video'||hasVideoUrl(asset)
    if(isVideo) args.push('-stream_loop','-1','-i',media)
    else args.push('-loop','1','-i',media)
  }else args.push('-f','lavfi','-i',`color=c=#111827:s=${WIDTH}x${HEIGHT}:r=${FPS}`)
  const audio=scene.tts_audio_url||scene.ttsAudioUrl
  let audioFile=null
  if(audio){
    try{audioFile=path.join(dir,`audio-${index}.${extFromUrl(audio,'mp3')}`);await download(audio,audioFile);args.push('-i',audioFile)}catch(e){console.warn(`scene ${index}: TTS unavailable, using silence:`,e.message);audioFile=null}
  }
  if(!audioFile) args.push('-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000')
  args.push('-t',String(d),'-vf',sceneFilter(textFile),'-r',String(FPS),'-c:v','libx264','-preset',process.env.VIDEO_PRESET||'veryfast','-crf',String(process.env.VIDEO_CRF||22),'-pix_fmt','yuv420p','-map','0:v:0','-map','1:a:0','-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart',out)
  await run(args)
  return out
}

export async function renderProject({project,scenes,workDir=await tmpDir()}={}){
  if(!Array.isArray(scenes)||!scenes.length) throw new Error('项目没有场景，无法渲染')
  await fs.mkdir(workDir,{recursive:true})
  const files=[]
  try{
    for(let i=0;i<scenes.length;i++) files.push(await renderScene(scenes[i],workDir,i+1))
    const list=path.join(workDir,'concat.txt')
    await fs.writeFile(list,files.map(f=>`file '${f.replace(/'/g,"'\\''")}'`).join('\n'),'utf8')
    const output=path.join(workDir,`${crypto.randomUUID()}.mp4`)
    await run(['-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',output])
    const stat=await fs.stat(output)
    return {output,bytes:stat.size,workDir}
  }catch(e){
    await fs.rm(workDir,{recursive:true,force:true}).catch(()=>{})
    throw e
  }
}
