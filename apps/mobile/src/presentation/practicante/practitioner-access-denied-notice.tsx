import { StyleSheet, Text, View } from "react-native";

import { Action } from "../components/screen";

export function PractitionerAccessDeniedNotice({
  message = "No existe una asignación válida para tu cuenta. Sólo puedes consultar acompañamientos que un profesional te haya asignado.",
  onBack,
}: {
  readonly message?: string;
  readonly onBack?: () => void;
}) {
  return (
    <View accessibilityRole="alert" style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        Acceso denegado
      </Text>
      <Text style={styles.message}>{message}</Text>
      {onBack ? <Action label="Volver a acompañamientos" onPress={onBack} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#FCEBEC",
    borderWidth: 1,
    borderColor: "#B42318",
  },
  title: { color: "#8A1C13", fontSize: 18, fontWeight: "700" },
  message: { color: "#5D2520", fontSize: 16, lineHeight: 23 },
});
