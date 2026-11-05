import { router, type NativeStackNavigationOptions } from "expo-router";
import { StyleSheet, View } from "react-native";

import { mobileDependencies } from "../../composition/mobile-dependencies";
import { getAccessibilityColorPalette } from "../accessibility/accessibility-color-palette";
import { useOptionalAccessibilityPreferences } from "../accessibility/accessibility-preferences-provider";
import { SpeechCommandLauncher } from "../accessibility/speech-controls";
import { appHeaderOptions } from "./app-header-options";
import {
  RoleTabBar,
  RoleTabIcon,
  roleTabAccessibilityLabel,
  Tabs,
  useRoleTabScreenOptions,
} from "./role-tabs";

export const studentLayoutScreenOptions = appHeaderOptions;

export const studentRequestScreenOptions = {
  ...appHeaderOptions,
  headerBackVisible: true,
} satisfies NativeStackNavigationOptions;

export default function StudentLayout() {
  const screenOptions = useRoleTabScreenOptions();
  const accessibility = useOptionalAccessibilityPreferences();
  const colors = getAccessibilityColorPalette(accessibility?.effective.highContrast ?? false);
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => (
          <View>
            <View style={[styles.commands, { backgroundColor: colors.background }]}>
              <SpeechCommandLauncher
                speechPort={mobileDependencies.speechRecognitionPort}
                onOpenRequests={() => router.push("/estudiante/solicitudes")}
                onBack={() => (router.canGoBack() ? router.back() : router.replace("/estudiante"))}
                inline
              />
            </View>
            <RoleTabBar {...props} />
          </View>
        )}
        screenOptions={screenOptions}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Inicio",
            tabBarAccessibilityLabel: roleTabAccessibilityLabel("Inicio", 1, 3),
            tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="house" />,
          }}
        />
        <Tabs.Screen
          name="solicitudes"
          options={{
            title: "Solicitudes",
            tabBarAccessibilityLabel: roleTabAccessibilityLabel("Solicitudes", 2, 3),
            tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="clipboardList" />,
          }}
        />
        <Tabs.Screen
          name="perfil"
          options={{
            title: "Perfil",
            tabBarAccessibilityLabel: roleTabAccessibilityLabel("Perfil", 3, 3),
            tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="user" />,
          }}
        />
        <Tabs.Screen name="nueva-solicitud" options={{ href: null }} />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  commands: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
});
