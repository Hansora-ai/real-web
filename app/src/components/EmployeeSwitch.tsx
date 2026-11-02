import { IonIcon, useIonActionSheet } from '@ionic/react';
import { chevronDown } from 'ionicons/icons';
import { useBusiness } from '../automation/business';
import { useI18n } from '../i18n';

// Tappable AI-employee name under a screen title, like the website's switcher.
export function EmployeeSwitch() {
  const { employees, current, businessId, choose } = useBusiness();
  const { t } = useI18n();
  const [sheet] = useIonActionSheet();
  if (!employees?.length) return null;
  const many = employees.length > 1;
  return (
    <button type="button" className="emp-switch" disabled={!many} onClick={() => sheet({
      header: t('account.chooseAiEmployee'),
      buttons: [...employees.map(e => ({ text: `${e.id === businessId ? '✓ ' : ''}${e.name}${e.instagram ? ` · ${e.instagram}` : ''}`, handler: () => choose(e.id) })), { text: t('common.cancel'), role: 'cancel' }],
    })}>
      <span className="emp-dot" />{current?.name}{current?.instagram ? <small>{current.instagram}</small> : null}{many && <IonIcon icon={chevronDown} />}
    </button>
  );
}
