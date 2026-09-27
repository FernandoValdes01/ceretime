import { StyleSheet, Text, View } from "react-native";

import type { PractitionerAccompanimentStatus } from "../../application/practitioner-accompaniment-models";
import { AppIcon } from "../components/app-icon";
import {
  practitionerAccompanimentStatusLabels,
  practitionerAccompanimentStatusMeta,
} from "./practitioner-accompaniment-formatters";

export function PractitionerAccompanimentStatusBadge({
  status,
}: {
  readonly status: PractitionerAccompanimentStatus;
}) {
  const meta = practitionerAccompanimentStatusMeta[status];

  return (
    <View
      accessible
      accessibilityLabel={`Estado: ${practitionerAccompanimentStatusLabels[status]}`}
      style={[styles.badge, { backgroundColor: meta.backgroundColor }]}
    >
      <AppIcon accessible={false} color={meta.color} name={meta.icon} size={15} strokeWidth={2.2} />
      <Text style={[styles.text, { color: meta.color }]}>
        {practitionerAccompanimentStatusLabels[status]}
      </Text>
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
