import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IonContent, IonHeader, IonIcon, IonModal, IonPage, IonRefresher, IonRefresherContent, IonSpinner, IonTitle, IonToolbar,
  useIonToast, type RefresherEventDetail,
} from '@ionic/react';
import { add, checkmark, chevronDown, chevronForward, close, flash, imagesOutline, remove, sparkles } from 'ionicons/icons';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { formatCredits, toDisplayCredits } from '../lib/credits';
import { MODELS, defaultOptions, frameSlots, isReady, maxUploads, modelLogo, type Model, type Options } from '../creative/models';
import { totalCredits } from '../creative/pricing';
import { checkGeneration, loadGenerations, resultUrls, startGeneration, statusOf, uploadFile, type Generation, type Submitted, type Upload } from '../creative/api';
import { ResultViewer } from '../components/ResultViewer';

type Kind = 'image' | 'video';
type Pending = { key: string; model: Model; prompt: string; sub?: Submitted; status: 'sending' | 'processing' | 'ready' | 'failed'; urls: string[]; reason?: string };

const isPreviewBuild = import.meta.env.MODE !== 'production' || location.pathname.includes('app-preview');

function ModelLogo({ model, size = 36 }: { model: Model; size?: number }) {
  const src = modelLogo(model);
  return (
    <span className="model-logo" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span>{model.emoji || '✦'}</span>}
    </span>
  );
}

function Chips({ label, values, value, onPick, format = (v: string) => v }: { label: string; values: string[]; value: string; onPick: (v: string) => void; format?: (v: string) => string }) {
  if (values.length < 2) return null;
  return (
    <div className="opt">
      <span className="opt-label">{label}</span>
      <div className="chips" role="radiogroup" aria-label={label}>
        {values.map(v => (
          <button key={v} type="button" role="radio" aria-checked={v === value} className={`chip${v === value ? ' on' : ''}`} onClick={() => onPick(v)}>{format(v)}</button>
        ))}
      </div>
    </div>
  );
}

export default function Create() {
  const { t } = useI18n();
  const auth = useAuth();
  const [toast] = useIonToast();
  const [kind, setKind] = useState<Kind>('image');
  const [model, setModel] = useState<Model>(() => MODELS.find(m => m.category === 'image' && isReady(m))!);
  const [options, setOptions] = useState<Options>(() => defaultOptions(MODELS.find(m => m.category === 'image' && isReady(m))!));
  const [prompt, setPrompt] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [frames, setFrames] = useState<(Upload | null)[]>([null, null]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [history, setHistory] = useState<Generation[] | null>(null);
  const [viewer, setViewer] = useState<{ urls: string[]; kind: string; prompt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const frameInput = useRef<HTMLInputElement>(null);
  const frameTarget = useRef(0);

  const say = useCallback((message: string) => { void toast({ message, duration: 3500, position: 'top', color: 'dark' }); }, [toast]);

  const refreshHistory = useCallback(async () => {
    try { setHistory(await loadGenerations(24)); } catch { setHistory(h => h ?? []); }
  }, []);
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);

  function chooseModel(next: Model) {
    setModel(next);
    setOptions(o => ({ ...defaultOptions(next), quantity: o.quantity }));
    const limit = maxUploads(next);
    setUploads(list => list.slice(0, limit));
    if (!frameSlots(next)) setFrames([null, null]);
    setPickerOpen(false);
  }

  function switchKind(next: Kind) {
    if (next === kind) return;
    setKind(next);
    chooseModel(MODELS.find(m => m.category === next && isReady(m)) || MODELS.find(m => m.category === next)!);
  }

  const cost = totalCredits(model, options);
  const balance = auth.profile ? Number(auth.profile.credits || 0) : null;
  const slots = frameSlots(model);
  const limit = maxUploads(model);
  const needsImage = !!model.needsImage && !(slots && model.startOptional);
  const accept = 'image/*';

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const room = Math.max(0, limit - uploads.length);
    const added = Array.from(files).slice(0, room).map(file => ({ file, previewUrl: URL.createObjectURL(file) }));
    if (files.length > room) say(t('create.maxFiles', { count: String(limit) }));
    setUploads(list => [...list, ...added]);
  }

  function setFrame(index: number, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setFrames(list => list.map((item, i) => (i === index ? { file, previewUrl: URL.createObjectURL(file) } : item)));
  }

  async function run() {
    if (!isReady(model)) return say(t('create.nextUpdate'));
    if (!prompt.trim()) return say(t('create.needPrompt'));
    const files = slots ? frames.filter((f): f is Upload => !!f) : uploads;
    if (needsImage && !files.length) return say(t('create.needImage'));
    if (cost !== null && balance !== null && balance < cost) return say(t('create.notEnough'));
    setBusy(true);
    const keys = Array.from({ length: options.quantity }, (_, i) => `${Date.now()}-${i}`);
    setPending(list => [...keys.map(key => ({ key, model, prompt: prompt.trim(), status: 'sending' as const, urls: [] })), ...list]);
    try {
      const maxMB = Number(model.uploadMaxMB || (model.id === 'nano-banana-2' ? 30 : model.id === 'nano-banana-pro' ? 25 : 10));
      const urls = await Promise.all(files.map(item => uploadFile(item.file, maxMB)));
      await Promise.all(keys.map(async key => {
        try {
          const sub = await startGeneration(model, { ...options, quantity: 1 }, prompt.trim(), urls, slots ? files.length : 0);
          setPending(list => list.map(p => (p.key === key ? { ...p, sub, status: 'processing' } : p)));
          void follow(key, sub);
        } catch (error) {
          const message = String((error as Error).message || '');
          setPending(list => list.map(p => (p.key === key ? { ...p, status: 'failed', reason: message } : p)));
          say(/credit/i.test(message) ? t('create.notEnough') : (error as { code?: string }).code === 'CONTENT_POLICY_BLOCKED' ? t('create.blocked') : t('create.failed'));
        }
      }));
      void auth.refreshProfile().catch(() => undefined);
    } catch (error) {
      setPending(list => list.map(p => (keys.includes(p.key) ? { ...p, status: 'failed' } : p)));
      say(String((error as Error).message) === 'file_too_large' ? t('create.tooLarge') : t('create.uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function follow(key: string, sub: Submitted) {
    const started = Date.now();
    while (Date.now() - started < 40 * 60 * 1000) {
      await new Promise(r => setTimeout(r, 3000));
      if (document.visibilityState === 'hidden') continue;
      const result = await checkGeneration(sub).catch(() => null);
      if (!result || result.status === 'processing') continue;
      setPending(list => list.map(p => (p.key === key ? { ...p, status: result.status, urls: result.urls, reason: result.reason } : p)));
      void auth.refreshProfile().catch(() => undefined);
      if (result.status === 'ready') { void refreshHistory(); setTimeout(() => setPending(list => list.filter(p => p.key !== key)), 400); }
      return;
    }
  }

  async function onRefresh(event: CustomEvent<RefresherEventDetail>) {
    await Promise.all([refreshHistory(), auth.refreshProfile().catch(() => undefined)]);
    event.detail.complete();
  }

  const list = useMemo(() => MODELS.filter(m => m.category === kind), [kind]);
  const shownHistory = (history || []).filter(row => resultUrls(row).length || statusOf(row) === 'processing').slice(0, 18);
  const ratioLabel = (v: string) => (v === 'auto' ? t('create.auto') : v);

  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar>
          <IonTitle>{t('tabs.create')}</IonTitle>
          <span slot="end" className="credit-pill"><IonIcon icon={flash} />{auth.profile ? toDisplayCredits(auth.profile.credits) : '…'}</span>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="create">
        <IonRefresher slot="fixed" onIonRefresh={onRefresh}><IonRefresherContent /></IonRefresher>

        <section className="create-hero">
          <span className="eyebrow"><i />HANSORA AI</span>
          <h1>{t('create.heroTitle')}</h1>
          <p className="gradient-text">{t('create.heroSub')}</p>
        </section>

        <section className="studio">
          <div className="kind-switch" role="tablist">
            {(['image', 'video'] as Kind[]).map(k => (
              <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => switchKind(k)}>
                {k === 'image' ? t('create.image') : t('create.video')}
              </button>
            ))}
          </div>

          <button type="button" className="model-row" onClick={() => setPickerOpen(true)}>
            <ModelLogo model={model} />
            <span className="model-row-text">
              <small>{t('create.model')}</small>
              <strong>{model.name}</strong>
            </span>
            {cost !== null && <span className="model-row-cost">{formatCredits(cost)}</span>}
            <IonIcon icon={chevronDown} />
          </button>

          <textarea className="prompt" rows={4} placeholder={t('create.promptPlaceholder')} value={prompt} onChange={e => setPrompt(e.target.value)} />

          {slots ? (
            <div className="frames">
              {[0, 1].map(i => (
                <button key={i} type="button" className={`drop frame${frames[i] ? ' filled' : ''}`} onClick={() => { frameTarget.current = i; frameInput.current?.click(); }}>
                  {frames[i] ? (
                    <>
                      <img src={frames[i]!.previewUrl} alt="" />
                      <span className="thumb-x" role="button" aria-label={t('create.remove')} onClick={e => { e.stopPropagation(); setFrames(f => f.map((x, j) => (j === i ? null : x))); }}><IonIcon icon={close} /></span>
                    </>
                  ) : (
                    <><span className="plus"><IonIcon icon={add} /></span><b>{i === 0 ? t('create.startFrame') : t('create.endFrame')}</b><small>{t('create.optional')}</small></>
                  )}
                </button>
              ))}
              <input ref={frameInput} type="file" accept={accept} hidden onChange={e => { setFrame(frameTarget.current, e.target.files); e.target.value = ''; }} />
            </div>
          ) : limit > 0 ? (
            <div className="uploads">
              {uploads.length > 0 && (
                <div className="thumbs">
                  {uploads.map((u, i) => (
                    <span className="thumb" key={u.previewUrl}>
                      <img src={u.previewUrl} alt="" />
                      <button type="button" className="thumb-x" aria-label={t('create.remove')} onClick={() => setUploads(list => list.filter((_, j) => j !== i))}><IonIcon icon={close} /></button>
                    </span>
                  ))}
                  {uploads.length < limit && <button type="button" className="thumb add" onClick={() => fileInput.current?.click()} aria-label={t('create.uploadImage')}><IonIcon icon={add} /></button>}
                </div>
              )}
              {uploads.length === 0 && (
                <button type="button" className="drop" onClick={() => fileInput.current?.click()}>
                  <span className="plus"><IonIcon icon={add} /></span>
                  <b>{t('create.uploadImage')}</b>
                  <small>{needsImage ? t('create.required') : t('create.optional')} · {t('create.upTo', { count: String(limit) })}</small>
                </button>
              )}
              <input ref={fileInput} type="file" accept={accept} multiple={limit > 1} hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>
          ) : null}

          <Chips label={t('create.aspect')} values={model.aspectOptions || []} value={options.aspect} onPick={v => setOptions(o => ({ ...o, aspect: v }))} format={ratioLabel} />
          <Chips label={t('create.quality')} values={model.resolutionOptions || []} value={options.resolution} onPick={v => setOptions(o => ({ ...o, resolution: v }))} />
          <Chips label={t('create.length')} values={(model.durations || []).map(String)} value={String(options.duration)} onPick={v => setOptions(o => ({ ...o, duration: Number(v) }))} format={v => `${v}s`} />
          {model.id === 'wan-2-7-image' && (
            <Chips label={t('create.tier')} values={['normal', 'pro']} value={options.tier} onPick={v => setOptions(o => ({ ...o, tier: v }))} format={v => (v === 'pro' ? 'Pro' : t('create.standard'))} />
          )}
          {model.id === 'kling26' && (
            <div className="opt row">
              <span className="opt-label">{t('create.sound')}</span>
              <button type="button" role="switch" aria-checked={options.sound} className={`toggle${options.sound ? ' on' : ''}`} onClick={() => setOptions(o => ({ ...o, sound: !o.sound }))}><i /></button>
            </div>
          )}

          <div className="opt row">
            <span className="opt-label">{t('create.quantity')}</span>
            <div className="stepper">
              <button type="button" aria-label="−" disabled={options.quantity <= 1} onClick={() => setOptions(o => ({ ...o, quantity: Math.max(1, o.quantity - 1) }))}><IonIcon icon={remove} /></button>
              <span>{options.quantity}</span>
              <button type="button" aria-label="+" disabled={options.quantity >= 4} onClick={() => setOptions(o => ({ ...o, quantity: Math.min(4, o.quantity + 1) }))}><IonIcon icon={add} /></button>
            </div>
          </div>

          <button type="button" className="run" disabled={busy} onClick={run}>
            {busy ? <IonSpinner name="crescent" /> : <>{t('create.run')} {cost !== null && <span className="run-cost">· {formatCredits(cost)}</span>} <IonIcon icon={sparkles} /></>}
          </button>
        </section>

        <section className="results">
          <div className="section-head"><h2>{t('create.yourCreations')}</h2></div>
          {pending.length === 0 && history === null && <div className="grid">{[0, 1, 2, 3].map(i => <div key={i} className="tile skeleton" />)}</div>}
          {pending.length === 0 && history !== null && shownHistory.length === 0 && (
            <div className="empty small"><div className="empty-icon"><IonIcon icon={imagesOutline} /></div><p>{t('create.noCreations')}</p></div>
          )}
          <div className="grid">
            {pending.map(p => (
              <button key={p.key} type="button" className={`tile ${p.status}`} disabled={p.status !== 'ready'} onClick={() => setViewer({ urls: p.urls, kind: p.model.category, prompt: p.prompt })}>
                {p.status === 'ready' && p.urls[0] ? (p.model.category === 'video' ? <video src={p.urls[0]} muted playsInline /> : <img src={p.urls[0]} alt="" />) : (
                  <span className="tile-state">
                    {p.status === 'failed' ? <><IonIcon icon={close} /><small>{t('create.failedShort')}</small></> : <><IonSpinner name="crescent" /><small>{p.status === 'sending' ? t('create.sending') : t('create.generating')}</small></>}
                  </span>
                )}
                <span className="tile-label">{p.model.name}</span>
              </button>
            ))}
            {shownHistory.map(row => {
              const urls = resultUrls(row);
              const isVideo = String(row.kind).toLowerCase() === 'video';
              return (
                <button key={row.id || row.created_at} type="button" className="tile" disabled={!urls.length} onClick={() => setViewer({ urls, kind: row.kind, prompt: row.prompt })}>
                  {urls[0] ? (isVideo ? <video src={`${urls[0]}#t=0.1`} muted playsInline preload="metadata" /> : <img src={urls[0]} alt="" loading="lazy" />) : <span className="tile-state"><IonSpinner name="crescent" /><small>{t('create.generating')}</small></span>}
                  <span className="tile-label">{row.provider}</span>
                </button>
              );
            })}
          </div>
        </section>
        <div className="safe-bottom" />

        <IonModal isOpen={pickerOpen} onDidDismiss={() => setPickerOpen(false)} initialBreakpoint={0.75} breakpoints={[0, 0.75, 1]} className="model-sheet">
          <div className="sheet-head"><h3>{kind === 'image' ? t('create.imageModels') : t('create.videoModels')}</h3><span>{list.length}</span></div>
          <div className="sheet-list">
            {list.map(m => {
              const ready = isReady(m);
              if (!ready && !isPreviewBuild) return null;
              return (
                <button key={m.id} type="button" className={`sheet-row${m.id === model.id ? ' on' : ''}${ready ? '' : ' soon'}`} onClick={() => (ready ? chooseModel(m) : say(t('create.nextUpdate')))}>
                  <ModelLogo model={m} size={40} />
                  <span className="sheet-text">
                    <strong>{m.name}{m.isNew && <em className="new">NEW</em>}</strong>
                    <small>{ready ? m.subtitle : t('create.nextUpdateShort')}</small>
                  </span>
                  <span className="sheet-cost">{m.costLabel?.replace(' per job', '')}</span>
                  <IonIcon icon={m.id === model.id ? checkmark : chevronForward} />
                </button>
              );
            })}
          </div>
        </IonModal>

        <ResultViewer item={viewer} onClose={() => setViewer(null)} />
      </IonContent>
    </IonPage>
  );
}
