import { Stack } from "expo-router";
import type { NativeStackNavigationOptions } from "expo-router";
import { appHeaderOptions } from "./app-header-options";

export const studentLayoutScreenOptions = appHeaderOptions;

export const studentRequestScreenOptions = {
  ...appHeaderOptions,
  headerBackVisible: true,
} satisfies NativeStackNavigationOptions;

export default function StudentLayout() {
  return (
    <Stack screenOptions={studentLayoutScreenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="nueva-solicitud" options={studentRequestScreenOptions} />
    </Stack>
  );
}
