import { router } from 'expo-router';
import { Action, Screen } from '../../../src/presentation/components/screen';
import { useNavigationSession } from '../../../src/presentation/navigation/session';

export default function StudentHome() {
  const { clearSession } = useNavigationSession();
  return (
    <Screen
      title="Inicio de Estudiante"
      description="Cuéntanos qué apoyo necesitas para participar en la vida universitaria."
    >
      <Action
        label="Nueva solicitud"
        onPress={() => router.push('/estudiante/nueva-solicitud')}
      />
      <Action label="Cambiar de rol" onPress={clearSession} />
    </Screen>
  );
}
