import { router } from 'expo-router';

import { Action, Screen } from '../src/presentation/components/screen';

export default function NotFound() {
  return (
    <Screen
      title="Página no encontrada"
      description="Esta dirección no existe en la aplicación."
    >
      <Action label="Volver al inicio" onPress={() => router.replace('/')} />
    </Screen>
  );
}
