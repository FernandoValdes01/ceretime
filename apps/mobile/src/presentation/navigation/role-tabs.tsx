import { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type ColorValue,
} from "react-native";
import { BottomTabBar, type BottomTabBarProps } from "expo-router/js-tabs";

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
    baseRoleTabScreenOptions.tabBarLabelStyle.lineHeight * Math.max(1, fontScale),
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
        {children}
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

/** Con texto grande la navegación usa filas, sin cortar nombres ni reducir la fuente. */
export function RoleTabBar(props: BottomTabBarProps) {
  const { fontScale } = useWindowDimensions();
  const preferences = useOptionalAccessibilityPreferences();
  const colors = getAccessibilityColorPalette(preferences?.effective.highContrast ?? false);
  const scale = preferences?.effective.textScale ?? fontScale;
  if (scale <= 1.3) return <BottomTabBar {...props} />;
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        padding: 8,
        paddingBottom: Math.max(8, props.insets.bottom),
        backgroundColor: colors.surface,
      }}
    >
      {props.state.routes.map((route, index) => {
        const options = props.descriptors[route.key].options;
        if (StyleSheet.flatten(options.tabBarItemStyle)?.display === "none") return null;
        const title = options.title ?? route.name;
        const selected = props.state.index === index;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={options.tabBarAccessibilityLabel ?? title}
            accessibilityState={{ selected }}
            onPress={() => {
              const event = props.navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!selected && !event.defaultPrevented)
                props.navigation.navigate(route.name, route.params);
            }}
            onLongPress={() => props.navigation.emit({ type: "tabLongPress", target: route.key })}
            style={{
              width: title === "Acompañamientos" ? "100%" : "50%",
              minHeight: 48,
              padding: 8,
              borderRadius: 12,
              justifyContent: "center",
              backgroundColor: selected ? colors.muted : colors.surface,
            }}
          >
            <StudentText
              weight="semibold"
              style={{
                fontSize: 14,
                color: selected ? colors.primary : colors.secondary,
                textAlign: "center",
              }}
            >
              {title}
            </StudentText>
          </Pressable>
        );
      })}
    </View>
  );
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
