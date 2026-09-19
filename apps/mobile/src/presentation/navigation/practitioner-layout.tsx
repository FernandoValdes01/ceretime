import { RoleTabIcon, roleTabScreenOptions, Tabs } from "./role-tabs";

export default function PractitionerLayout() {
  return (
    <Tabs screenOptions={roleTabScreenOptions}>
      <Tabs.Screen
        name="asignaciones"
        options={{
          title: "Inicio",
          tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="graduationCap" />,
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: "Perfil",
          tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="user" />,
        }}
      />
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="sin-asignacion" options={{ href: null }} />
    </Tabs>
  );
}
