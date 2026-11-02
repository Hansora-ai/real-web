import { IonContent, IonHeader, IonIcon, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import { useI18n } from '../i18n';

// A clearly-marked screen for parts not built yet. Only in preview builds — never shipped to the stores.
export default function StepPreview({ title, heading, body, icon }: { title: string; heading: string; body: string; icon: string }) {
  const { t } = useI18n();
  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar><IonTitle>{title}</IonTitle></IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar><IonTitle size="large">{title}</IonTitle></IonToolbar>
        </IonHeader>
        <div className="empty">
          <div className="empty-icon"><IonIcon icon={icon} /></div>
          <span className="h-badge">{t('preview.badge')}</span>
          <h2>{heading}</h2>
          <p>{body}</p>
        </div>
      </IonContent>
    </IonPage>
  );
}
