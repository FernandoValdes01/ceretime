import { Stack } from "expo-router";

export default function PublicLayout() {
  return (
    <Stack>
      <Stack.Screen name="login" options={{ title: "Acceso de prueba" }} />
    </Stack>
  );
}
