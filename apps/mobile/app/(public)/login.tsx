import { Action, Screen } from '../../src/presentation/components/screen';
import { roles } from '../../src/presentation/navigation/roles';
import { useNavigationSession } from '../../src/presentation/navigation/session';

export default function Login() {
  const { selectRole } = useNavigationSession();

  return (
    <Screen
      title="Explora la aplicación"
      description="Elige un rol para recorrer esta versión de prueba. La sesión es simulada y se reinicia al cerrar o recargar la aplicación."
    >
      {roles.map(({ id, label }) => (
        <Action
          key={id}
          label={`Entrar como ${label}`}
          onPress={() => selectRole(id)}
        />
      ))}
    </Screen>
  );
}
