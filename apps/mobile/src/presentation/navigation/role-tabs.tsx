import { useState } from "react";
import { Platform, useWindowDimensions, type ColorValue } from "react-native";

import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppIconName } from "../components/app-icon";
import { getAccessibilityColorPalette } from "../accessibility/accessibility-color-palette";
import { useOptionalAccessibilityPreferences } from "../accessibility/accessibility-preferences-provider";
import { AppIcon } from "../components/app-icon";
import { StudentText } from "../estudiante/student-text";

const baseRoleTabScreenOptions = {
  headerShown: false,
  tabBarActiveTintColor: "#087D70",
  tabBarInactiveTintColor: "#5B6C6E",
  tabBarLabelStyle: { fontSize: 12, lineHeight: 16, fontWeight: "600" as const },
  tabBarStyle: {
    height: 66,
    paddingTop: 0,
    paddingBottom: 4,
    borderTopColor: "#D7E1DF",
    backgroundColor: "#FFFFFF",
  },
};

const tabLabelBreaks: Readonly<Record<string, number>> = {
  Solicitudes: 8,
  Acompañamientos: 8,
};

function getVisibleTabLabel(label: string) {
  const breakAt = tabLabelBreaks[label];
  if (breakAt === undefined) return label;
  return `${label.slice(0, breakAt)}\u200B${label.slice(breakAt)}`;
}

export function useRoleTabScreenOptions() {
  const { bottom } = useSafeAreaInsets();
  const { fontScale: systemFontScale, width } = useWindowDimensions();
  const accessibility = useOptionalAccessibilityPreferences();
  const fontScale = accessibility?.effective.textScale ?? systemFontScale;
  const colors = getAccessibilityColorPalette(accessibility?.effective.highContrast ?? false);
  const iconSize = 21 * Math.min(1.5, Math.max(1, fontScale));
  const layoutKey = `${width}:${fontScale}`;
  const [labelLayout, setLabelLayout] = useState<{
    key: string;
    heights: Readonly<Record<string, number>>;
  }>({ key: layoutKey, heights: {} });
  const labelHeight = Math.max(
    2 * baseRoleTabScreenOptions.tabBarLabelStyle.lineHeight * Math.max(1, fontScale),
    ...(labelLayout.key === layoutKey ? Object.values(labelLayout.heights) : []),
  );
  const bottomPadding = Math.max(bottom, baseRoleTabScreenOptions.tabBarStyle.paddingBottom);

  return {
    ...baseRoleTabScreenOptions,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.secondary,
    tabBarIconStyle: {
      width: iconSize,
      height: iconSize,
    },
    tabBarLabelPosition: "below-icon" as const,
    tabBarLabel: ({ children, color }: { children: string; color: ColorValue }) => (
      <StudentText
        style={[
          baseRoleTabScreenOptions.tabBarLabelStyle,
          { color, textAlign: "center", maxWidth: "100%" },
        ]}
        onTextLayout={({ nativeEvent: { lines } }) => {
          const height = Math.ceil(Math.max(0, ...lines.map((line) => line.y + line.height)));
          setLabelLayout((current) => {
            if (current.key === layoutKey && current.heights[children] === height) return current;
            return {
              key: layoutKey,
              heights: {
                ...(current.key === layoutKey ? current.heights : {}),
                [children]: height,
              },
            };
          });
        }}
      >
        {getVisibleTabLabel(children)}
      </StudentText>
    ),
    tabBarStyle: {
      ...baseRoleTabScreenOptions.tabBarStyle,
      // Cada botón de Tabs aporta 5 puntos de relleno superior e inferior.
      height: Math.ceil(iconSize + labelHeight + 10) + bottomPadding,
      paddingBottom: bottomPadding,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
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
  const preferences = useOptionalAccessibilityPreferences();
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(1.5, Math.max(1, preferences?.effective.textScale ?? fontScale));
  return <AppIcon color={color} name={name} size={21 * scale} strokeWidth={2.1} />;
}

export { Tabs };
