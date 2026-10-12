import Busboy from 'busboy';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateProject, duration, audioClips } from '../../public/caption-studio/core.mjs';
import { exportPlan } from '../../public/caption-studio/export-plan.mjs';
const run = promisify(execFile), downloads = new Map();
export const nativeExport = process.env.CAPTION_STUDIO_BROWSER_EXPORT !== '1' && await Promise.all([run('ffmpeg', ['-version']), run('ffprobe', ['-version'])]).then(() => true, () => false);
let running = false;
export async function localRender(req, res, url, send) {
  const prefix = '/api/caption-studio/render';
  if (!url.pathname.startsWith(prefix)) return false;
  if (req.method === 'GET' && url.pathname.startsWith(prefix + '/')) {
    const id = url.pathname.slice(prefix.length + 1), item = downloads.get(id);
    if (!item) { send(404, { error: 'This download has expired. Export again.' }); return true; }
    const info = await stat(join(item.dir, 'finished.mp4'));
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': info.size, 'Cache-Control': 'no-store' });
    await pipeline(createReadStream(join(item.dir, 'finished.mp4')), res).finally(async () => {
      downloads.delete(id); clearTimeout(item.timer); await rm(item.dir, { recursive: true, force: true });
    });
    return true;
  }
  if (url.pathname !== prefix || req.method !== 'POST') { send(405, { error: 'Method not allowed.' }); return true; }
  if (!nativeExport) { send(503, { error: 'Native export is unavailable.' }); return true; }
  if (running) { send(409, { error: 'Another export is running. Wait for it to finish.' }); return true; }
  running = true;
  let dir, process, completed = false, disconnected = false;
  const close = () => { disconnected = true; process?.kill('SIGKILL'); };
  res.on('close', close);
  try {
    dir = await mkdtemp(join(tmpdir(), 'hansora-render-'));
    let meta, totalBytes = 0;
    const files = new Set(), writes = [];
    const parser = Busboy({ headers: req.headers, limits: { files: 10002, fields: 1, fieldSize: 8 * 1048576, fileSize: 200 * 1048576 } });
    parser.on('field', (name, value, info) => {
      if (name !== 'meta' || info.valueTruncated) { parser.destroy(Error('Invalid export metadata.')); return; }
      try { meta = JSON.parse(value); } catch { parser.destroy(Error('Invalid export metadata.')); }
    });
    parser.on('file', (name, stream) => {
      stream.on('error', () => {});
      if (!/^(media\d{1,3}|audio\d{1,3}|overlay\d{1,5}\.png|music)$/.test(name) || files.has(name)) {
        stream.resume(); parser.destroy(Error('Invalid export file.')); return;
      }
      files.add(name);
      stream.on('data', chunk => {
        totalBytes += chunk.length;
        if (totalBytes > 512 * 1048576) parser.destroy(Error('Export exceeds the local memory limit.'));
      });
      stream.on('limit', () => parser.destroy(Error('A source exceeds 200 MB.')));
      const writing = pipeline(stream, createWriteStream(join(dir, name)));
      writing.catch(() => {}); writes.push(writing);
    });
    parser.on('filesLimit', () => parser.destroy(Error('Too many caption frames.')));
    await new Promise((resolve, reject) => {
      parser.once('close', resolve);
      parser.once('error', error => { req.unpipe(parser); req.resume(); reject(error); });
      req.once('aborted', () => parser.destroy(Error('Export cancelled.')));
      req.once('error', error => parser.destroy(error));
      req.pipe(parser);
    });
    await Promise.all(writes);
    if (disconnected) throw Error('Export cancelled.');
    if (!meta || !Array.isArray(meta.assets) || meta.assets.length > 100) throw Error('Invalid media list.');
    const assets = new Map(), audio = new Map();
    for (let i = 0; i < meta.assets.length; i++) {
      const a = meta.assets[i];
      if (!files.has(`media${i}`) || typeof a.id !== 'string') throw Error('A source video is missing.');
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(dir, `media${i}`)], { timeout: 30000 });
      const probe = JSON.parse(stdout), video = probe.streams.find(s => s.codec_type === 'video');
      if (!video) throw Error('A source has no video.');
      assets.set(a.id, { kind: a.kind === 'image' ? 'image' : 'video', width: video.width, height: video.height, duration: a.kind === 'image' ? 3600 : Number(probe.format.duration) });
      audio.set(a.id, probe.streams.some(s => s.codec_type === 'audio'));
    }
    const audioAssets = meta.audioAssets || (meta.project?.music ? [{id:meta.project.music.assetId}] : []);
    if (!Array.isArray(audioAssets) || audioAssets.length>100) throw Error('Invalid audio list.');
    for(let i=0;i<audioAssets.length;i++) {
      const filename=files.has(`audio${i}`) ? `audio${i}` : i===0 && files.has('music') ? 'music' : null;
      if(!filename) throw Error('An audio file is missing.');
      if(filename==='music') await writeFile(join(dir,'audio0'),await readFile(join(dir,'music')));
      const {stdout}=await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',join(dir,filename)],{timeout:30000});
      const probe=JSON.parse(stdout);
      if(!probe.streams.some(s=>s.codec_type==='audio')) throw Error('Choose a file containing audio.');
      if(!assets.has(audioAssets[i].id)) assets.set(audioAssets[i].id,{kind:'audio',duration:Number(probe.format.duration)});
    }
    // Layers are already rasterized in the uploaded overlay frames.
    const p = validateProject({ ...meta.project, layers: (meta.project.layers || []).map(l=>({...l,kind:'text'})) }, assets);
    if (!duration(p) || duration(p) > 3600) throw Error('Choose a project shorter than one hour.');
    const times = meta.times;
    if (!Array.isArray(times) || times.length > 10001 || times.length < 2 || times[0] !== 0 || Math.abs(times.at(-1) - duration(p)) > .001 || times.some((t,i) => !Number.isFinite(t) || (i && t <= times[i-1]))) throw Error('Invalid caption timing.');
    const overlays = times.length > 2 || files.has('overlay0.png');
    if (overlays) {
      let manifest = 'ffconcat version 1.0\n';
      for (let i = 0; i < times.length-1; i++) {
        if (!files.has(`overlay${i}.png`)) throw Error('A caption frame is missing.');
        manifest += `file 'overlay${i}.png'\noption framerate 1000\nduration ${(times[i+1]-times[i]).toFixed(6)}\n`;
      }
      manifest += `file 'overlay${times.length-2}.png'\noption framerate 1000\n`;
      await writeFile(join(dir, 'overlays.txt'), manifest);
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    const emit = data => { if (!disconnected) res.write(JSON.stringify(data) + '\n'); };
    emit({ progress: 25, label: 'Rendering locally…' });
    const args = exportPlan(p, assets, audio, overlays, 4);
    args.splice(1, 0, '-progress', 'pipe:1', '-nostats');
    if (disconnected) throw Error('Export cancelled.');
    process = spawn('ffmpeg', args, { cwd: dir, stdio: ['ignore','pipe','pipe'] });
    let log = '', pending = '';
    process.stderr.on('data', d => { log = (log+d).slice(-6000); });
    process.stdout.on('data', d => {
      pending += d;
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) if (line.startsWith('out_time_us=')) {
        const seconds = Number(line.slice(12)) / 1e6;
        emit({ progress: Math.min(98, 25 + 73 * seconds / duration(p)), label: `Rendering locally… ${Math.min(100, Math.round(100 * seconds / duration(p)))}%` });
      }
    });
    await new Promise((resolve, reject) => {
      process.once('error', reject);
      process.once('exit', code => code === 0 ? resolve() : reject(Error(disconnected ? 'Export cancelled.' : 'Could not render this project. ' + log.split('\n').filter(l => /error|invalid|failed|unable/i.test(l)).slice(-5).join(' '))));
    });
    if (disconnected) throw Error('Export cancelled.');
    const id = randomUUID();
    const timer = setTimeout(() => { downloads.delete(id); rm(dir, { recursive: true, force: true }); }, 10 * 60 * 1000);
    timer.unref(); downloads.set(id, { dir, timer }); completed = true;
    emit({ progress: 100, url: `${prefix}/${id}`, label: 'Your video is ready.' }); res.end();
  } catch (error) {
    if (!disconnected) {
      if (res.headersSent) res.end(JSON.stringify({ error: error.message }) + '\n');
      else send(400, { error: error.message });
    }
  } finally {
    res.off('close', close); running = false;
    if (!completed && dir) await rm(dir, { recursive: true, force: true });
  }
  return true;
}
