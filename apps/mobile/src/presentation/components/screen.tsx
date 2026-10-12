import { useState, type PropsWithChildren, type Ref } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAccessibilityColorPalette } from "../accessibility/accessibility-color-palette";
import { useOptionalAccessibilityPreferences } from "../accessibility/accessibility-preferences-provider";
import { StudentText } from "../estudiante/student-text";
import { AppHeader } from "./app-header";

export function Screen({
  title,
  description,
  children,
  scrollRef,
  showAppHeader = false,
  headerTitle = "CERETI",
}: PropsWithChildren<{
  title: string;
  description?: string;
  scrollRef?: Ref<ScrollView>;
  showAppHeader?: boolean;
  headerTitle?: string;
}>) {
  const accessibility = useOptionalAccessibilityPreferences();
  const colors = getAccessibilityColorPalette(accessibility?.effective.highContrast ?? false);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={showAppHeader ? ["top", "left", "right", "bottom"] : ["left", "right", "bottom"]}
    >
      {showAppHeader ? <AppHeader title={headerTitle} /> : null}
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <StudentText accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {title}
        </StudentText>
        {description ? (
          <StudentText style={[styles.description, { color: colors.secondary }]}>
            {description}
          </StudentText>
        ) : null}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const accessibility = useOptionalAccessibilityPreferences();
  const colors = getAccessibilityColorPalette(accessibility?.effective.highContrast ?? false);

  return (
    <Pressable
      // Este botón conserva el callback de StyleSheet, sin conversión de clases.
      cssInterop={false}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        focused && [styles.focused, { outlineColor: colors.focus }],
        pressed && styles.pressed,
        disabled && styles.disabled,
        { backgroundColor: pressed ? colors.actionPressed : colors.action },
      ]}
    >
      <StudentText style={[styles.buttonLabel, { color: colors.surface }]}>{label}</StudentText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7FAF9" },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    padding: 24,
    gap: 16,
  },
  title: { color: "#182C31", fontSize: 30, fontWeight: "700" },
  description: {
    color: "#42565B",
    fontSize: 17,
    lineHeight: 26,
    marginBottom: 8,
  },
  button: {
    minHeight: 52,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#246259",
  },
  focused: { outlineWidth: 3, outlineColor: "#2563EB", outlineOffset: 2 },
  pressed: { backgroundColor: "#17483F" },
  disabled: { opacity: 0.55 },
  buttonLabel: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
});
