import { Stack } from 'expo-router';

import { useNavigationSession } from '../../src/presentation/navigation/session';

export default function ProtectedLayout() {
  const { role } = useNavigationSession();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={role === 'estudiante'}>
        <Stack.Screen name="estudiante" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'profesional'}>
        <Stack.Screen name="profesional" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'practicante'}>
        <Stack.Screen name="practicante" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'administrador'}>
        <Stack.Screen name="administrador" />
      </Stack.Protected>
    </Stack>
  );
}
