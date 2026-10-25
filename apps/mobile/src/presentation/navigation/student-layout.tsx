import { router, type NativeStackNavigationOptions } from "expo-router";
import { View } from "react-native";

import { mobileDependencies } from "../../composition/mobile-dependencies";
import { SpeechCommandLauncher } from "../accessibility/speech-controls";
import { appHeaderOptions } from "./app-header-options";
import { RoleTabIcon, roleTabAccessibilityLabel, Tabs, useRoleTabScreenOptions } from "./role-tabs";

export const studentLayoutScreenOptions = appHeaderOptions;

export const studentRequestScreenOptions = {
  ...appHeaderOptions,
  headerBackVisible: true,
} satisfies NativeStackNavigationOptions;

export default function StudentLayout() {
  const screenOptions = useRoleTabScreenOptions();
  const tabBarHeight =
    typeof screenOptions.tabBarStyle.height === "number" ? screenOptions.tabBarStyle.height : 66;

  return (
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={screenOptions}>
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
      <SpeechCommandLauncher
        speechPort={mobileDependencies.speechRecognitionPort}
        onOpenRequests={() => router.push("/estudiante/solicitudes")}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/estudiante"))}
        bottomOffset={tabBarHeight + 16}
      />
    </View>
  );
}
