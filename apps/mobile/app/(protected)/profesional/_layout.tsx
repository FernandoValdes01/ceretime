import { Tabs } from "expo-router";

import { mobileDependencies } from "../../../src/composition/mobile-dependencies";
import { RoleTabIcon, roleTabScreenOptions } from "../../../src/presentation/navigation/role-tabs";
import { ProfessionalAgendaProvider } from "../../../src/presentation/profesional/professional-agenda-provider";
import { ProfessionalReviewProvider } from "../../../src/presentation/profesional/professional-review-provider";

export default function ProfessionalLayout() {
  return (
    <ProfessionalReviewProvider port={mobileDependencies.professionalReviewPort}>
      <ProfessionalAgendaProvider reader={mobileDependencies.professionalAgendaReader}>
        <Tabs initialRouteName="(agenda)" screenOptions={roleTabScreenOptions}>
          <Tabs.Screen name="inicio" options={{ href: null }} />
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
              title: "Solicitudes",
              tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="clipboardList" />,
            }}
          />
          <Tabs.Screen name="estudiantes/[requestId]" options={{ href: null }} />
          <Tabs.Screen
            name="perfil"
            options={{
              title: "Perfil",
              tabBarIcon: ({ color }) => <RoleTabIcon color={String(color)} name="user" />,
            }}
          />
        </Tabs>
      </ProfessionalAgendaProvider>
    </ProfessionalReviewProvider>
  );
}
