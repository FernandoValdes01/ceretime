import { RoleTabIcon, roleTabAccessibilityLabel, Tabs, useRoleTabScreenOptions } from "./role-tabs";

export default function RoleLayout() {
  const screenOptions = useRoleTabScreenOptions();

  return (
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
        name="usuarios"
        options={{
          title: "Usuarios",
          tabBarAccessibilityLabel: roleTabAccessibilityLabel("Usuarios", 2, 3),
          tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="users" />,
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
    </Tabs>
  );
}
