import { Section, Text } from '@react-email/components';
import * as React from 'react';
import EmailLayout, { styles } from './EmailLayout';

export interface GenericNotificationProps {
  title?: string;
  bodyText?: string | null;
  details?: Record<string, unknown> | null;
}

/** Fallback for outbox templates without a dedicated design. */
export default function GenericNotification({
  title = 'Notificación',
  bodyText,
  details,
}: GenericNotificationProps) {
  const entries = details
    ? Object.entries(details).filter(([, v]) => v != null && typeof v !== 'object')
    : [];
  return (
    <EmailLayout preview={title}>
      <Text style={styles.h1}>{title}</Text>
      {bodyText ? <Text style={styles.text}>{bodyText}</Text> : null}
      {entries.length > 0 ? (
        <Section style={styles.infoBox}>
          {entries.map(([k, v]) => (
            <Text key={k} style={{ ...styles.text, margin: '0 0 4px' }}>
              <strong>{k}:</strong> {String(v)}
            </Text>
          ))}
        </Section>
      ) : null}
    </EmailLayout>
  );
}
