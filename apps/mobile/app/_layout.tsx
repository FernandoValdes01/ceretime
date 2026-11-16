import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LogBox } from "react-native";

import { mobileDependencies } from "../src/composition/mobile-dependencies";
import {
  NavigationSessionProvider,
  useNavigationSession,
} from "../src/presentation/navigation/session";
import { Screen } from "../src/presentation/components/screen";
import { appHeaderOptions } from "../src/presentation/navigation/app-header-options";
import { AccessibilityPreferencesProvider } from "../src/presentation/accessibility/accessibility-preferences-provider";

LogBox.ignoreLogs(["[Reanimated] Reduced motion setting is enabled on this device."]);

function RootNavigator() {
  const { role, isRestoring } = useNavigationSession();

  // Sin esperar, la persona con sesión guardada vería el acceso un instante antes de su inicio.
  if (isRestoring) return <Screen title="Cargando CERETI…" description="Recuperando tu sesión." />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
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
    <AccessibilityPreferencesProvider port={mobileDependencies.accessibilityPreferencesPort}>
      <NavigationSessionProvider
        authPort={mobileDependencies.authPort}
        demoCredentials={mobileDependencies.demoCredentials}
      >
        <StatusBar style="dark" />
        <RootNavigator />
      </NavigationSessionProvider>
    </AccessibilityPreferencesProvider>
  );
}
