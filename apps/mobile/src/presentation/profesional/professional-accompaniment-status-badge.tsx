import { StyleSheet, View } from "react-native";

import type {
  ProfessionalAccompaniment,
  ProfessionalAccompanimentStatus,
} from "@/application/professional-accompaniment-models";
import { AppIcon, type AppIconName } from "@/presentation/components/app-icon";
import { StudentText } from "@/presentation/estudiante/student-text";

export const professionalAccompanimentStatusPresentations = {
  active: { label: "Activo", icon: "circleCheck" },
  paused: { label: "En pausa", icon: "clock" },
  closed: { label: "Cerrado", icon: "circleX" },
} satisfies Record<ProfessionalAccompanimentStatus, { label: string; icon: AppIconName }>;

export function ProfessionalAccompanimentStatusBadge({
  status,
  accessible = true,
}: Pick<ProfessionalAccompaniment, "status"> & { readonly accessible?: boolean }) {
  const presentation = professionalAccompanimentStatusPresentations[status];

  return (
    <View
      accessible={accessible}
      accessibilityLabel={accessible ? `Estado: ${presentation.label}` : undefined}
      style={styles.statusBadge}
    >
      <AppIcon
        accessible={false}
        color="#087D70"
        name={presentation.icon}
        size={16}
        strokeWidth={2.2}
      />
      <StudentText weight="semibold" style={styles.statusText}>
        {presentation.label}
      </StudentText>
    </View>
  );
}

const styles = StyleSheet.create({
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "#E8F4F1",
  },
  statusText: { color: "#087D70", fontSize: 12, lineHeight: 16 },
});
