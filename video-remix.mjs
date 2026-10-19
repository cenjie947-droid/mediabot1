import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const AI_API_KEY = process.env.AI_API_KEY
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini'

function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], ...opts })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 12000) stderr = stderr.slice(-12000) })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(stderr) : reject(new Error(stderr.trim().slice(-1800) || '命令执行失败（' + code + '）')))
  })
}

async function durationOf(file) {
  const output = await run(ffmpegPath, ['-hide_banner', '-i', file, '-f', 'null', '-']).catch(e => e.message)
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!match) throw new Error('无法读取视频时长，请确认文件是可播放的视频格式')
  return { duration: Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]), hasAudio: /Audio:/.test(output) }
}

async function extractFrames(file, duration, assetIndex, dir) {
  const count = Math.min(4, Math.max(2, Math.ceil(duration / 12)))
  const frames = []
  for (let i = 0; i < count; i++) {
    const time = Math.min(Math.max(0.2, duration - 0.2), duration * (i + 0.5) / count)
    const target = path.join(dir, 'frame-' + assetIndex + '-' + i + '.jpg')
    await run(ffmpegPath, ['-y', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '6', target])
    frames.push({ assetIndex, timeSeconds: Number(time.toFixed(2)), bytes: await readFile(target) })
  }
  return frames
}

async function planWithAI(referenceUrl, referenceNotes, assets, frames, referenceImageBytes = null, referenceImageMime = 'image/jpeg', musicOptions = [], referenceVideoFrames = [], referenceTranscript = '') {
  if (!AI_API_KEY) throw new Error('未配置 AI_API_KEY，无法分析参考爆款和素材镜头')
  const allFrames = [...referenceVideoFrames.map(frame => ({ ...frame, isReference: true })), ...frames].slice(0, 48)
  const frameMessages = allFrames.map(frame => ({
    type: 'image_url',
    image_url: { url: 'data:image/jpeg;base64,' + frame.bytes.toString('base64'), detail: 'low' }
  }))
  const frameLabels = allFrames.map((f, i) => '图片' + (i + (referenceImageBytes ? 2 : 1)) + '=' + (f.isReference ? '爆款参考视频' : '自有素材' + (f.assetIndex + 1)) + '，时间点' + f.timeSeconds + '秒').join('\n')
  const system = '你是短视频剪辑导演。用户提供的原始素材是唯一可用画面来源，严禁建议生成AI视频或虚构素材。根据参考爆款信息和素材关键帧，返回严格JSON：title, hook, structure, musicMood, targetDuration, clips数组。每个clips元素包含assetIndex(从0开始), startSeconds, endSeconds, purpose。只能选择已提供素材的索引；片段长度2到6秒，时间不能超出素材时长；优先选择视觉明确、动作/情绪鲜明的镜头，按开头吸引点、主体、高潮、结尾排序。如果提供了参考视频关键帧和语音转写，必须综合分析画面、台词、节奏与情绪；仅提供链接时不得声称已观看链接。'
  const musicText = musicOptions.length ? '配乐候选（索引：文件名）：' + musicOptions.map((m,i)=>i + ': ' + m.fileName).join(' | ') + '。请根据画面情绪和文件名线索选择最合适的配乐，并返回selectedMusicIndex。' : '没有可选配乐。'
  const userText = '参考爆款链接：' + (referenceUrl || '未提供') + '\n用户补充的参考说明：' + (referenceNotes || '未提供') + '\n参考视频语音转写：\n' + (referenceTranscript || '未能取得参考视频语音转写') + '\n素材信息：\n' + assets.map((a,i)=>'素材' + (i+1) + '（索引' + i + '）：文件名=' + a.fileName + '，时长=' + a.duration.toFixed(1) + '秒').join('\n') + '\n关键帧标记：\n' + frameLabels + '\n请规划一条约30秒、使用现有素材剪辑的新视频。选择最多10段镜头，总时长控制在15到60秒；只返回JSON。配乐信息：' + musicText
  const response = await fetch(AI_BASE_URL + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AI_API_KEY },
    body: JSON.stringify({
      model: AI_MODEL, temperature: 0.3, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: userText + (referenceImageBytes ? '\n第一张图片是用户提供的爆款参考截图，后续图片是用户素材关键帧。' : '\n图片均为用户素材关键帧。') }, ...(referenceImageBytes ? [{ type: 'image_url', image_url: { url: 'data:' + referenceImageMime + ';base64,' + referenceImageBytes.toString('base64'), detail: 'high' } }] : []), ...frameMessages] }]
    })
  })
  const raw = await response.text()
  if (!response.ok && response.status === 401) throw new Error('AI 接口认证失败（401）：当前 AI_API_KEY 无效或与 AI_BASE_URL 不匹配。请在服务器环境变量中更换有效密钥；不要把密钥发到聊天里。')
  if (!response.ok) throw new Error('AI 镜头分析失败（' + response.status + '）：请检查 AI 服务配置后重试。' + (response.status >= 500 ? ' 服务商暂时异常。' : ''))
  const content = JSON.parse(raw).choices?.[0]?.message?.content
  if (!content) throw new Error('AI 未返回剪辑方案')
  return JSON.parse(content)
}

export async function createVideoRemix({ admin, userId, referenceUrl = '', referenceNotes = '', assetPaths = [], musicPath = '', referenceImagePath = '', referenceImageMime = 'image/jpeg', referenceVideoPath = '', musicOptions = [] }) {
  if (!ffmpegPath) throw new Error('当前服务器没有可用的 FFmpeg 视频处理程序')
  if (!Array.isArray(assetPaths) || assetPaths.length < 1 || assetPaths.length > 12) throw new Error('请先选择1到12个自己的视频素材')
  const temp = await mkdtemp(path.join(os.tmpdir(), 'mediabot-remix-'))
  try {
    const assets = []
    const frames = []
    for (let i = 0; i < assetPaths.length; i++) {
      const storagePath = String(assetPaths[i] || '')
      if (!storagePath.startsWith(userId + '/') || storagePath.includes('..')) throw new Error('素材路径无效或不属于当前用户')
      const { data, error } = await admin.storage.from('publish-media').download(storagePath)
      if (error || !data) throw new Error('无法读取素材 ' + (i + 1) + '：' + (error?.message || '文件不存在'))
      const fileName = path.basename(storagePath).replace(/[^a-zA-Z0-9._-]/g, '_')
      const localPath = path.join(temp, 'input-' + i + '-' + fileName)
      await writeFile(localPath, Buffer.from(await data.arrayBuffer()))
      const mediaInfo = await durationOf(localPath)
      const duration = mediaInfo.duration
      const asset = { storagePath, fileName, localPath, duration, hasAudio: mediaInfo.hasAudio }
      assets.push(asset)
      frames.push(...await extractFrames(localPath, duration, i, temp))
    }
    let referenceImageBytes = null
    const referenceVideoFrames = []
    let referenceTranscript = ''
    if (referenceVideoPath) {
      if (!String(referenceVideoPath).startsWith(userId + '/') || String(referenceVideoPath).includes('..')) throw new Error('参考视频路径无效或不属于当前用户')
      const { data, error } = await admin.storage.from('publish-media').download(referenceVideoPath)
      if (error || !data) throw new Error('无法读取爆款参考视频')
      const referenceLocalPath = path.join(temp, 'reference-video.mp4')
      await writeFile(referenceLocalPath, Buffer.from(await data.arrayBuffer()))
      const info = await durationOf(referenceLocalPath)
      referenceVideoFrames.push(...(await extractFrames(referenceLocalPath, info.duration, -1, temp)).map(f => ({ ...f, isReference: true })))
      if (info.hasAudio && AI_API_KEY) {
        const audioPath = path.join(temp, 'reference-audio.mp3')
        await run(ffmpegPath, ['-y', '-i', referenceLocalPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-t', '300', audioPath])
        try {
          const audioBytes = await readFile(audioPath)
          const form = new FormData()
          form.append('model', 'whisper-1')
          form.append('file', new Blob([audioBytes], { type: 'audio/mpeg' }), 'reference-audio.mp3')
          const tr = await fetch(AI_BASE_URL + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + AI_API_KEY }, body: form })
          if (tr.ok) referenceTranscript = String((await tr.json()).text || '').slice(0, 12000)
        } catch { /* transcription is optional; video analysis can continue without it */ }
      }
    }
    if (referenceImagePath) {
      if (!String(referenceImagePath).startsWith(userId + '/') || String(referenceImagePath).includes('..')) throw new Error('参考截图路径无效或不属于当前用户')
      const { data, error } = await admin.storage.from('publish-media').download(referenceImagePath)
      if (error || !data) throw new Error('无法读取爆款参考截图')
      referenceImageBytes = Buffer.from(await data.arrayBuffer())
    }
    const plan = await planWithAI(referenceUrl, referenceNotes, assets, frames, referenceImageBytes, referenceImageMime, musicOptions, referenceVideoFrames, referenceTranscript)
    const proposed = Array.isArray(plan.clips) ? plan.clips.slice(0, 10) : []
    const clips = proposed.map(c => {
      const assetIndex = Number(c.assetIndex), asset = assets[assetIndex]
      if (!asset) return null
      const start = Math.max(0, Number(c.startSeconds) || 0)
      const end = Math.min(asset.duration, Number(c.endSeconds) || start + 3)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1 || start >= asset.duration) return null
      return { assetIndex, start: Math.max(0, Math.min(start, asset.duration - 0.5)), end, purpose: String(c.purpose || '').slice(0, 160), localPath: asset.localPath }
    }).filter(Boolean)
    if (!clips.length) throw new Error('AI 没有选出可用片段，请换一批素材或补充爆款内容说明后重试')
    const chosenMusicIndex = musicOptions.length ? Math.max(0, Math.min(musicOptions.length - 1, Number(plan.selectedMusicIndex) || 0)) : -1
    const chosenMusicPath = musicPath || (chosenMusicIndex >= 0 ? musicOptions[chosenMusicIndex].storagePath : '')
    const chosenMusicName = musicPath ? '手动选择的配乐' : (chosenMusicIndex >= 0 ? musicOptions[chosenMusicIndex].fileName : '')
    const rendered = []
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i], target = path.join(temp, 'clip-' + i + '.mp4')
      const clipArgs = ['-y', '-ss', String(clip.start), '-i', clip.localPath]
      if (!assets[clip.assetIndex].hasAudio) clipArgs.push('-f', 'lavfi', '-t', String(clip.end - clip.start), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
      clipArgs.push('-t', String(clip.end - clip.start), '-map', '0:v:0', '-map', assets[clip.assetIndex].hasAudio ? '0:a:0?' : '1:a:0', '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-avoid_negative_ts', 'make_zero', target)
      await run(ffmpegPath, clipArgs)
      rendered.push(target)
    }
    const listPath = path.join(temp, 'concat.txt')
    await writeFile(listPath, rendered.map(f => "file '" + f.replace(/'/g, "'\\''") + "'").join('\n'))
    const output = path.join(temp, 'mediabot-remix.mp4')
    await run(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', output])
    if (chosenMusicPath) {
      if (!String(chosenMusicPath).startsWith(userId + '/') || String(chosenMusicPath).includes('..')) throw new Error('配乐文件路径无效或不属于当前用户')
      const { data, error } = await admin.storage.from('publish-media').download(chosenMusicPath)
      if (error || !data) throw new Error('无法读取你上传的配乐文件')
      const musicFile = path.join(temp, 'background-music')
      await writeFile(musicFile, Buffer.from(await data.arrayBuffer()))
      const mixed = path.join(temp, 'mixed.mp4')
      await run(ffmpegPath, ['-y', '-i', output, '-stream_loop', '-1', '-i', musicFile, '-filter_complex', '[1:a]volume=0.18[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[a]', '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mixed])
      await writeFile(output, await readFile(mixed))
    }
    const outputPath = userId + '/remix-' + Date.now() + '-' + randomUUID().slice(0,8) + '.mp4'
    const outputBytes = await readFile(output)
    const { error: uploadError } = await admin.storage.from('publish-media').upload(outputPath, outputBytes, { contentType: 'video/mp4', upsert: false })
    if (uploadError) throw new Error('成片上传失败：' + uploadError.message)
    return {
      outputPath,
      editPlan: {
        title: String(plan.title || 'MediaBot 自动剪辑').slice(0, 160),
        hook: String(plan.hook || '').slice(0, 500),
        structure: String(plan.structure || '').slice(0, 1000),
        musicMood: String(plan.musicMood || '').slice(0, 120),
        clips: clips.map(c => ({ assetIndex: c.assetIndex, fileName: assets[c.assetIndex].fileName, startSeconds: Number(c.start.toFixed(2)), endSeconds: Number(c.end.toFixed(2)), purpose: c.purpose })),
        durationSeconds: Number(clips.reduce((n,c)=>n+c.end-c.start,0).toFixed(1)),
        musicApplied: Boolean(chosenMusicPath),
        selectedMusicName: chosenMusicName,
        referenceAnalyzed: Boolean(referenceVideoPath || referenceImageBytes), referenceTranscriptAvailable: Boolean(referenceTranscript), disclaimer: 'AI已结合可用的参考画面与语音转写（如有）以及自有素材关键帧规划剪辑。仅粘贴链接但未上传参考视频时，系统无法保证读取链接内容。发布前请检查成片和素材授权。'
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}
