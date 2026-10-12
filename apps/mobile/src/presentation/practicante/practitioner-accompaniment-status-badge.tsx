import { StyleSheet, View } from "react-native";

import type { PractitionerAccompanimentStatus } from "../../application/practitioner-accompaniment-models";
import { getAccessibilityColorPalette } from "../accessibility/accessibility-color-palette";
import { useOptionalAccessibilityPreferences } from "../accessibility/accessibility-preferences-provider";
import { AppIcon } from "../components/app-icon";
import {
  practitionerAccompanimentStatusLabels,
  practitionerAccompanimentStatusMeta,
} from "./practitioner-accompaniment-formatters";
import { StudentText } from "../estudiante/student-text";

export function PractitionerAccompanimentStatusBadge({
  status,
  accessible = true,
}: {
  readonly status: PractitionerAccompanimentStatus;
  readonly accessible?: boolean;
}) {
  const meta = practitionerAccompanimentStatusMeta[status];
  const accessibility = useOptionalAccessibilityPreferences();
  const palette = getAccessibilityColorPalette(accessibility?.effective.highContrast ?? false);
  const statusColors = {
    success: { background: palette.successSurface, foreground: palette.success },
    warning: { background: palette.warningSurface, foreground: palette.warning },
    muted: { background: palette.muted, foreground: palette.secondary },
  }[meta.tone];

  return (
    <View
      accessible={accessible}
      accessibilityLabel={
        accessible ? `Estado: ${practitionerAccompanimentStatusLabels[status]}` : undefined
      }
      style={[styles.badge, { backgroundColor: statusColors.background }]}
    >
      <AppIcon
        accessible={false}
        color={statusColors.foreground}
        name={meta.icon}
        size={15}
        strokeWidth={2.2}
      />
      <StudentText accessible={false} style={[styles.text, { color: statusColors.foreground }]}>
        {practitionerAccompanimentStatusLabels[status]}
      </StudentText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  text: { fontSize: 13, fontWeight: "700", lineHeight: 16 },
});
