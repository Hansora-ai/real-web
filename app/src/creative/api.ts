import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase';
import { SITE_URL } from '../lib/config';
import type { Model, Options } from './models';
import { buildBody } from './requests';

// In the installed app requests go to hansora.co through the phone's own HTTP (no browser CORS);
// in the browser preview the app is served by the same site as the functions.
const API = Capacitor.isNativePlatform() ? SITE_URL : '';

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

export type Upload = { file: File; previewUrl: string };

/** Same direct upload as the website: ask sign-upload for a link, then PUT the file there. */
export async function uploadFile(file: File, maxMB: number): Promise<string> {
  if (file.size > maxMB * 1024 * 1024) throw new Error('file_too_large');
  const mime = file.type || 'application/octet-stream';
  const filename = (file.name || 'upload.bin').replace(/[^A-Za-z0-9._-]/g, '_');
  const signRes = await fetch(`${API}/.netlify/functions/sign-upload`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename, mime }),
  });
  const signed = await signRes.json().catch(() => null);
  if (!signRes.ok || !signed?.uploadUrl || !signed?.publicUrl) throw new Error(signed?.error || `sign_failed_${signRes.status}`);
  const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': String(signed.mime || mime) }, body: file });
  if (!put.ok && put.status !== 409) throw new Error(`upload_failed_${put.status}`);
  return signed.publicUrl as string;
}

function taskIdOf(p: any): string {
  if (!p || typeof p !== 'object') return '';
  const c = [p.taskId, p.id, p.task_id, p.requestId, p.request_id, p.data?.taskId, p.data?.id, p.data?.task_id, p.data?.requestId, p.data?.request_id,
    p.data?.data?.taskId, p.data?.data?.id, p.data?.data?.task_id, p.result?.taskId, p.result?.id, p.result?.task_id];
  for (const v of c) { const s = String(v || '').trim(); if (s.length > 3) return s; }
  return '';
}

function errorOf(p: any): string {
  if (!p || typeof p !== 'object') return '';
  return String(p.message || p.error || p.msg || p.data?.msg || p.data?.error || '').trim();
}

export type Submitted = { runId: string; taskId: string; checker: string };

/** Starts one generation through the same safety gateway (safe-run) the website uses. */
export async function startGeneration(model: Model, o: Options, prompt: string, urls: string[], frameCount: number): Promise<Submitted> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error('login_required');
  const runId = `${uid}-${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const body = buildBody(model, { uid, runId, urls, prompt, o, frameCount });
  body.client_diagnostic = {
    model_id: model.id, model_name: model.name, aspect_ratio: o.aspect, duration: o.duration, resolution: o.resolution,
    input_urls: urls, uploaded_url_count: urls.length, user_agent: `HansoraApp/${Capacitor.getPlatform()} ${navigator.userAgent}`,
  };
  const access = await token();
  const res = await fetch(`${API}/.netlify/functions/safe-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-USER-ID': uid, ...(access ? { Authorization: `Bearer ${access}` } : {}) },
    body: JSON.stringify({ target_endpoint: model.endpoint, model_id: model.id, model_name: model.name, kind: model.category, prompt, usage_mode: 'credits', payload: body }),
  });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const error = new Error(errorOf(json) || text || `status_${res.status}`) as Error & { code?: string };
    error.code = json?.code;
    throw error;
  }
  const taskId = taskIdOf(json);
  const failed = json && (json.ok === false || json.success === false) && !taskId;
  if (failed) throw new Error(errorOf(json) || 'generation_failed');
  return { runId, taskId, checker: ['seedance25', 'seedance20', 'wan-3'].includes(model.id) ? 'reapi-check' : 'kie-check' };
}

export type Generation = { id?: string; provider: string; kind: string; prompt: string; result_url: string | null; meta: any; created_at: string };

export function resultUrls(row: Generation | null): string[] {
  if (!row) return [];
  const m = row.meta || {};
  const list = [row.result_url, ...(Array.isArray(m.urls) ? m.urls : []), ...(Array.isArray(m.result_urls) ? m.result_urls : []), ...(Array.isArray(m.resultUrls) ? m.resultUrls : [])];
  return Array.from(new Set(list.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))));
}

export function statusOf(row: Generation | null): 'ready' | 'failed' | 'processing' {
  if (!row) return 'processing';
  const s = String(row.meta?.status || '').toLowerCase();
  if (resultUrls(row).length && !/fail|error/.test(s)) return 'ready';
  if (/fail|error|cancel|reject/.test(s)) return 'failed';
  return 'processing';
}

/** One check, like pollGeneration() on the website: the provider checker, then the user_generations row. */
export async function checkGeneration(sub: Submitted): Promise<{ status: 'ready' | 'failed' | 'processing'; urls: string[]; reason?: string }> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id || '';
  try {
    const q = `${sub.taskId ? `taskId=${encodeURIComponent(sub.taskId)}&` : ''}uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(sub.runId)}`;
    const access = sub.checker === 'reapi-check' ? await token() : '';
    const res = await fetch(`${API}/.netlify/functions/${sub.checker}?${q}`, { cache: 'no-store', headers: { Accept: 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}) } });
    const js = await res.json().catch(() => null);
    const st = String(js?.status || '').toLowerCase();
    if (js?.failed || st.includes('fail') || st.includes('cancel')) return { status: 'failed', urls: [], reason: errorOf(js) };
    const direct = [js?.video_url, js?.result_url, js?.url, js?.output, js?.urls?.[0], js?.result_urls?.[0], js?.resultUrls?.[0]].find(v => typeof v === 'string' && /^https?:\/\//i.test(v));
    if (direct) return { status: 'ready', urls: [direct] };
  } catch { /* fall back to the database row */ }
  const { data: row } = await supabase.from('user_generations').select('id,provider,kind,prompt,result_url,meta,created_at')
    .eq('user_id', uid).eq('meta->>run_id', sub.runId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return { status: statusOf(row as Generation | null), urls: resultUrls(row as Generation | null) };
}

/** The user's generations, newest first (same table and columns as the website's history). */
export async function loadGenerations(limit = 60, before?: string): Promise<Generation[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  let query = supabase.from('user_generations').select('id,provider,kind,prompt,result_url,meta,created_at')
    .eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as Generation[];
}
