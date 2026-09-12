import type { PropsWithChildren, Ref } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function Screen({
  title,
  description,
  children,
  scrollRef,
}: PropsWithChildren<{
  title: string;
  description: string;
  scrollRef?: Ref<ScrollView>;
}>) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <Text style={styles.brand}>CERETIME</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.description}>{description}</Text>
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
  return (
    <Pressable
      // Este botón conserva el callback de StyleSheet, sin conversión de clases.
      cssInterop={false}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F5F7F8" },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    padding: 24,
    gap: 16,
  },
  brand: {
    color: "#246259",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
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
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#246259",
  },
  pressed: { backgroundColor: "#17483F" },
  disabled: { opacity: 0.55 },
  buttonLabel: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
});
