import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import {
  NavigationSessionProvider,
  useNavigationSession,
} from "../src/presentation/navigation/session";
import { appHeaderOptions } from "../src/presentation/navigation/app-header-options";

function RootNavigator() {
  const { role } = useNavigationSession();

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Protected guard={role === null}>
        <Stack.Screen name="(public)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={role !== null}>
        <Stack.Screen name="(protected)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="+not-found" options={appHeaderOptions} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <NavigationSessionProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </NavigationSessionProvider>
  );
}
