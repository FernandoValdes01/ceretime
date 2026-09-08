import { Stack } from 'expo-router';

export default function RoleLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{ title: 'Inicio', headerBackVisible: false }}
      />
    </Stack>
  );
}
