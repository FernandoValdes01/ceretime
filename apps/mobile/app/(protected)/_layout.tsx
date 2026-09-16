import { Stack } from "expo-router";

export default function ProtectedLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="estudiante" />
      <Stack.Screen name="profesional" />
      <Stack.Screen name="practicante" />
      <Stack.Screen name="administrador" />
    </Stack>
  );
}
