import { Stack } from "expo-router";
import type { NativeStackNavigationOptions } from "expo-router";

export const studentLayoutScreenOptions = {
  headerShown: false,
} satisfies NativeStackNavigationOptions;

export const studentRequestScreenOptions = {
  headerShown: true,
  headerTitle: "",
  headerBackTitle: "Volver",
  headerBackButtonDisplayMode: "minimal",
  headerBackVisible: true,
  headerTintColor: "#246259",
  headerStyle: { backgroundColor: "#F5F7F8" },
  headerShadowVisible: false,
} satisfies NativeStackNavigationOptions;

export default function StudentLayout() {
  return (
    <Stack screenOptions={studentLayoutScreenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="nueva-solicitud" options={studentRequestScreenOptions} />
    </Stack>
  );
}
