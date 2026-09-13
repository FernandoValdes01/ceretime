import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { mobileDependencies } from "../src/composition/mobile-dependencies";
import {
  NavigationSessionProvider,
  useNavigationSession,
} from "../src/presentation/navigation/session";

function RootNavigator() {
  const { role } = useNavigationSession();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={role === null}>
        <Stack.Screen name="(public)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={role !== null}>
        <Stack.Screen name="(protected)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <NavigationSessionProvider
      authPort={mobileDependencies.authPort}
      demoCredentials={mobileDependencies.demoCredentials}
    >
      <StatusBar style="dark" />
      <RootNavigator />
    </NavigationSessionProvider>
  );
}
