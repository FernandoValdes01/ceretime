import type { NativeStackNavigationOptions } from "expo-router";
import { appHeaderOptions } from "./app-header-options";
import { RoleTabIcon, roleTabScreenOptions, Tabs } from "./role-tabs";

export const studentLayoutScreenOptions = appHeaderOptions;

export const studentRequestScreenOptions = {
  ...appHeaderOptions,
  headerBackVisible: true,
} satisfies NativeStackNavigationOptions;

export default function StudentLayout() {
  return (
    <Tabs screenOptions={roleTabScreenOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Inicio",
          tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="house" />,
        }}
      />
      <Tabs.Screen
        name="solicitudes"
        options={{
          title: "Solicitudes",
          tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="clipboardList" />,
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: "Perfil",
          tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="user" />,
        }}
      />
      <Tabs.Screen name="nueva-solicitud" options={{ href: null }} />
    </Tabs>
  );
}
