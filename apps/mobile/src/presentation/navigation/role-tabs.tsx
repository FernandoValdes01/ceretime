import { Platform, Text, useWindowDimensions, type ColorValue } from "react-native";

import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppIconName } from "../components/app-icon";
import { AppIcon } from "../components/app-icon";

const baseRoleTabScreenOptions = {
  headerShown: false,
  tabBarActiveTintColor: "#087D70",
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

export function useRoleTabScreenOptions() {
  const { bottom } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();

  return {
    ...baseRoleTabScreenOptions,
    tabBarLabelPosition: "below-icon" as const,
    tabBarLabel: ({ children, color }: { children: string; color: ColorValue }) => (
      <Text style={[baseRoleTabScreenOptions.tabBarLabelStyle, { color, textAlign: "center" }]}>
        {children}
      </Text>
    ),
    tabBarStyle: {
      ...baseRoleTabScreenOptions.tabBarStyle,
      height: 42 + 42 * Math.max(1, fontScale) + bottom,
      paddingBottom: Math.max(bottom, baseRoleTabScreenOptions.tabBarStyle.paddingBottom),
    },
  };
}

export function roleTabAccessibilityLabel(label: string, position: number, total: number) {
  return Platform.select({ ios: `${label}, pestaña, ${position} de ${total}` });
}

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
