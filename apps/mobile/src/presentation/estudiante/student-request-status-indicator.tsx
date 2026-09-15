import { View } from "react-native";

import type { StudentRequestStatus } from "@/application/student-area-models";
import { StudentText } from "./student-text";

interface StudentRequestStatusPresentation {
  readonly label: string;
  readonly symbol: string;
}

const STATUS_PRESENTATIONS = {
  received: { label: "Recibida", symbol: "↓" },
  underReview: { label: "En revisión", symbol: "◷" },
  awaitingInformationOrAcceptance: {
    label: "Esperando información o aceptación",
    symbol: "!",
  },
  accepted: { label: "Aceptada", symbol: "✓" },
  referred: { label: "Derivada", symbol: "→" },
  closedWithoutAccompaniment: { label: "Cerrada sin acompañamiento", symbol: "×" },
  cancelled: { label: "Cancelada", symbol: "−" },
} satisfies Record<StudentRequestStatus, StudentRequestStatusPresentation>;

export function getStudentRequestStatusPresentation(
  status: StudentRequestStatus,
): StudentRequestStatusPresentation {
  return STATUS_PRESENTATIONS[status];
}

export function StudentRequestStatusIndicator({ status }: { status: StudentRequestStatus }) {
  const presentation = getStudentRequestStatusPresentation(status);

  return (
    <View className="flex-row items-center gap-3 border-b border-student-border pb-4">
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="h-10 w-10 items-center justify-center rounded-full border border-student-outline bg-student-muted"
      >
        <StudentText
          accessible={false}
          weight="semibold"
          className="text-student-primary text-xl leading-[28px]"
        >
          {presentation.symbol}
        </StudentText>
      </View>
      <View className="flex-1 gap-1">
        <StudentText
          accessible={false}
          weight="semibold"
          className="text-student-secondary text-sm leading-[20px]"
          selectable={false}
        >
          Estado de la solicitud
        </StudentText>
        <StudentText
          accessible
          accessibilityRole="text"
          accessibilityLabel={`Estado de la solicitud: ${presentation.label}`}
          className="text-student-text text-base leading-[26px]"
          selectable
        >
          {presentation.label}
        </StudentText>
      </View>
    </View>
  );
}
