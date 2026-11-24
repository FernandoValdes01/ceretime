import { Stack } from "expo-router";
import { useEffect } from "react";
import { AccessibilityInfo } from "react-native";

import { Screen } from "../components/screen";
import { appHeaderOptions } from "./app-header-options";
import { useNavigationSession } from "./session";

const restoringTitle = "Cargando CERETI…";
const restoringDescription = "Recuperando tu sesión.";

export function RootNavigator() {
  const { role, isRestoring } = useNavigationSession();

  useEffect(() => {
    if (isRestoring) {
      AccessibilityInfo.announceForAccessibility(`${restoringTitle} ${restoringDescription}`);
    }
  }, [isRestoring]);

  // Sin esperar, la persona con sesión guardada vería el acceso un instante antes de su inicio.
  if (isRestoring) return <Screen title={restoringTitle} description={restoringDescription} />;

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
