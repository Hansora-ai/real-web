import { IonIcon } from '@ionic/react';
import { call, chatbubbleEllipses, logoFacebook, logoInstagram, logoTiktok, logoWhatsapp, paperPlane } from 'ionicons/icons';
import { platformOf } from '../automation/api';

const ICONS: Record<string, string> = { instagram: logoInstagram, whatsapp: logoWhatsapp, tiktok: logoTiktok, messenger: logoFacebook, telegram: paperPlane, phone: call };

export function ChannelIcon({ type }: { type: string }) {
  const key = platformOf(type);
  return <i className={`ch ch-${key}`}><IonIcon icon={ICONS[key] || chatbubbleEllipses} /></i>;
}

export function Avatar({ name, url, type, size = 48 }: { name: string; url?: string; type?: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?';
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" onError={e => { (e.currentTarget as HTMLImageElement).remove(); }} /> : null}
      <b>{initials}</b>
      {type && <ChannelIcon type={type} />}
    </span>
  );
}
