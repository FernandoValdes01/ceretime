import { StyleSheet, View } from "react-native";

import { getAccessibilityColorPalette } from "../accessibility/accessibility-color-palette";
import { useOptionalAccessibilityPreferences } from "../accessibility/accessibility-preferences-provider";
import { Action } from "../components/screen";
import { StudentText } from "../estudiante/student-text";

export function PractitionerAccessDeniedNotice({
  message = "No existe una asignación válida para tu cuenta. Sólo puedes consultar acompañamientos que un profesional te haya asignado.",
  onBack,
}: {
  readonly message?: string;
  readonly onBack?: () => void;
}) {
  const accessibility = useOptionalAccessibilityPreferences();
  const colors = getAccessibilityColorPalette(accessibility?.effective.highContrast ?? false);

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.container,
        { backgroundColor: colors.errorSurface, borderColor: colors.error },
      ]}
    >
      <StudentText accessibilityRole="header" style={[styles.title, { color: colors.error }]}>
        Acceso denegado
      </StudentText>
      <StudentText style={[styles.message, { color: colors.secondary }]}>{message}</StudentText>
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
