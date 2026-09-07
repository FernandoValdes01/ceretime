import { router } from 'expo-router';
import {
  StudentAction,
  StudentScreen,
} from '../../../src/presentation/estudiante/student-screen';
import { useNavigationSession } from '../../../src/presentation/navigation/session';

export default function StudentHome() {
  const { clearSession } = useNavigationSession();
  return (
    <StudentScreen
      title="Inicio de Estudiante"
      description="Cuéntanos qué apoyo necesitas para participar en la vida universitaria."
    >
      <StudentAction
        label="Nueva solicitud"
        description="Cuéntanos qué acompañamiento necesitas"
        onPress={() => router.push('/estudiante/nueva-solicitud')}
      />
      <StudentAction label="Cambiar de rol" onPress={clearSession} secondary />
    </StudentScreen>
  );
}
