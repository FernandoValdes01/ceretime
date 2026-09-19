import { Tabs } from "expo-router";

import { mobileDependencies } from "../../../src/composition/mobile-dependencies";
import { RoleTabIcon, roleTabScreenOptions } from "../../../src/presentation/navigation/role-tabs";
import { ProfessionalAgendaProvider } from "../../../src/presentation/profesional/professional-agenda-provider";

export default function ProfessionalLayout() {
  return (
    <ProfessionalAgendaProvider reader={mobileDependencies.professionalAgendaReader}>
      <Tabs screenOptions={roleTabScreenOptions}>
        <Tabs.Screen
          name="inicio"
          options={{
            title: "Inicio",
            tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="house" />,
          }}
        />
        <Tabs.Screen
          name="(agenda)"
          options={{
            title: "Agenda",
            tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="calendar" />,
          }}
        />
        <Tabs.Screen
          name="estudiantes"
          options={{
            title: "Estudiantes",
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
    </ProfessionalAgendaProvider>
  );
}
