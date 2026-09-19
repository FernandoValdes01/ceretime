import { RoleTabIcon, roleTabScreenOptions, Tabs } from "./role-tabs";

export default function RoleLayout() {
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
        name="usuarios"
        options={{
          title: "Usuarios",
          tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="users" />,
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: "Perfil",
          tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="user" />,
        }}
      />
    </Tabs>
  );
}
