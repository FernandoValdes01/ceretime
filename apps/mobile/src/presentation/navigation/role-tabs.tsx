import { Tabs } from "expo-router";

import type { AppIconName } from "../components/app-icon";
import { AppIcon } from "../components/app-icon";

export const roleTabScreenOptions = {
  headerShown: false,
  tabBarActiveTintColor: "#078B7B",
  tabBarInactiveTintColor: "#5B6C6E",
  tabBarLabelStyle: { fontSize: 12, fontWeight: "600" as const },
  tabBarStyle: {
    height: 66,
    paddingTop: 6,
    paddingBottom: 8,
    borderTopColor: "#D7E1DF",
    backgroundColor: "#FFFFFF",
  },
};

export function RoleTabIcon({
  color,
  name,
}: {
  readonly color: string;
  readonly name: AppIconName;
}) {
  return <AppIcon color={color} name={name} size={21} strokeWidth={2.1} />;
}

export { Tabs };
