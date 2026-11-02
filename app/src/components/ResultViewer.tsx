import { useState } from 'react';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonToolbar } from '@ionic/react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { close, downloadOutline, shareOutline } from 'ionicons/icons';
import { useI18n } from '../i18n';

type Item = { urls: string[]; kind: string; prompt: string } | null;

// Full-screen view of a result, with Save and Share (like the website's preview overlay).
export function ResultViewer({ item, onClose }: { item: Item; onClose: () => void }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const url = item?.urls[Math.min(index, (item?.urls.length || 1) - 1)] || '';
  const isVideo = String(item?.kind || '').toLowerCase() === 'video';

  async function save() {
    if (!url) return;
    if (Capacitor.isNativePlatform()) return void Browser.open({ url });
    const a = document.createElement('a');
    a.href = url; a.download = ''; a.target = '_blank'; a.rel = 'noopener';
    a.click();
  }

  async function share() {
    if (!url) return;
    try { if (navigator.share) return await navigator.share({ url, text: item?.prompt || 'Hansora' }); } catch { return; }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
  }

  return (
    <IonModal isOpen={!!item} onDidDismiss={() => { setIndex(0); onClose(); }} className="viewer">
      <IonHeader translucent>
        <IonToolbar>
          <IonButtons slot="start"><IonButton onClick={onClose} aria-label={t('common.done')}><IonIcon icon={close} /></IonButton></IonButtons>
          <IonButtons slot="end">
            <IonButton onClick={share} aria-label={t('create.share')}><IonIcon icon={shareOutline} /></IonButton>
            <IonButton onClick={save} aria-label={t('create.save')}><IonIcon icon={downloadOutline} /></IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="viewer-content">
        <div className="viewer-media">
          {url && (isVideo ? <video src={url} controls autoPlay playsInline loop /> : <img src={url} alt={item?.prompt || ''} />)}
        </div>
        {item && item.urls.length > 1 && (
          <div className="viewer-dots">{item.urls.map((u, i) => <button key={u} type="button" className={i === index ? 'on' : ''} onClick={() => setIndex(i)} aria-label={`${i + 1}`} />)}</div>
        )}
        {item?.prompt && <p className="viewer-prompt">{item.prompt}</p>}
      </IonContent>
    </IonModal>
  );
}
