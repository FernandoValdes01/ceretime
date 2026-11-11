import {
  RoleTabBar,
  RoleTabIcon,
  roleTabAccessibilityLabel,
  Tabs,
  useRoleTabScreenOptions,
} from "./role-tabs";

// Pestañas del Practicante; `index` y `sin-asignacion` existen como rutas, pero no como pestañas.
export default function InternLayout() {
  const screenOptions = useRoleTabScreenOptions();

  return (
    <Tabs tabBar={(props) => <RoleTabBar {...props} />} screenOptions={screenOptions}>
      <Tabs.Screen
        name="asignaciones"
        options={{
          title: "Inicio",
          tabBarAccessibilityLabel: roleTabAccessibilityLabel("Inicio", 1, 2),
          tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="graduationCap" />,
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: "Perfil",
          tabBarAccessibilityLabel: roleTabAccessibilityLabel("Perfil", 2, 2),
          tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="user" />,
        }}
      />
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="sin-asignacion" options={{ href: null }} />
    </Tabs>
  );
}
