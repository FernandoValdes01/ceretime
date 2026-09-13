import { Stack } from "expo-router";

export default function PractitionerLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Inicio", headerBackVisible: false }} />
      <Stack.Screen name="asignaciones" options={{ title: "Acompañamientos asignados" }} />
      <Stack.Screen name="sin-asignacion" options={{ title: "Sin asignaciones" }} />
    </Stack>
  );
}
