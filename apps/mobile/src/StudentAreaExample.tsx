import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { MobileClient, StudentAreaSnapshot } from './mobile-client';

interface StudentAreaExampleProps {
  readonly client: MobileClient;
}

/** Isolated consumption example: the screen knows only the client boundary. */
export function StudentAreaExample({ client }: StudentAreaExampleProps) {
  const [snapshot, setSnapshot] = useState<StudentAreaSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void client
      .getStudentArea()
      .then((area) => {
        if (active) setSnapshot(area);
      })
      .catch(() => {
        if (active) setError('No fue posible cargar el área de estudiante.');
      });

    return () => {
      active = false;
    };
  }, [client]);

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!snapshot) return <ActivityIndicator accessibilityLabel="Cargando área de estudiante" />;

  const activeAccompaniment = snapshot.accompaniments.find(
    (accompaniment) => accompaniment.status === 'active',
  );
  const nextAppointment = snapshot.appointments.find(
    (appointment) => appointment.status === 'scheduled',
  );
  const followUp = activeAccompaniment
    ? snapshot.followUps.find((item) => item.accompanimentId === activeAccompaniment.id)
    : undefined;

  return (
    <View style={styles.content}>
      <Text style={styles.eyebrow}>Área {snapshot.user.area}</Text>
      <Text style={styles.title}>Hola, {snapshot.user.displayName}</Text>
      <Text style={styles.caption}>Rol provisional: {snapshot.user.role}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Solicitud</Text>
        <Text>{snapshot.requests[0]?.needSummary ?? 'Sin solicitudes registradas.'}</Text>
        <Text style={styles.muted}>
          Estado: {snapshot.requests[0]?.status ?? 'no disponible'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Acompañamiento</Text>
        <Text>{activeAccompaniment?.objective ?? 'Sin acompañamiento activo.'}</Text>
        {nextAppointment ? <Text style={styles.muted}>Próxima atención agendada</Text> : null}
        {followUp ? <Text style={styles.muted}>Seguimiento: {followUp.nextStep}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, padding: 24 },
  eyebrow: { color: '#52606d', fontSize: 14, textTransform: 'uppercase' },
  title: { color: '#102a43', fontSize: 26, fontWeight: '700' },
  caption: { color: '#52606d' },
  card: { backgroundColor: '#f0f4f8', borderRadius: 12, gap: 6, padding: 16 },
  cardTitle: { color: '#102a43', fontSize: 17, fontWeight: '700' },
  muted: { color: '#52606d', fontSize: 13 },
  error: { color: '#b42318', padding: 24 },
});
