import "../global.css";
import { StatusBar } from "expo-status-bar";
import { LogBox } from "react-native";

import { mobileDependencies } from "../src/composition/mobile-dependencies";
import { RootNavigator } from "../src/presentation/navigation/root-navigator";
import { NavigationSessionProvider } from "../src/presentation/navigation/session";
import { AccessibilityPreferencesProvider } from "../src/presentation/accessibility/accessibility-preferences-provider";

LogBox.ignoreLogs(["[Reanimated] Reduced motion setting is enabled on this device."]);

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
