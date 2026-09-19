import { View } from "react-native";

import type { StudentRequestStatus } from "@/application/student-area-models";
import { AppIcon, type AppIconName } from "../components/app-icon";
import { StudentText } from "./student-text";

interface StudentRequestStatusPresentation {
  readonly label: string;
  readonly icon: AppIconName;
}

const STATUS_PRESENTATIONS = {
  received: { label: "Recibida", icon: "arrowDown" },
  underReview: { label: "En revisión", icon: "clock" },
  awaitingInformationOrAcceptance: {
    label: "Esperando información o aceptación",
    icon: "alert",
  },
  accepted: { label: "Aceptada", icon: "circleCheck" },
  referred: { label: "Derivada", icon: "arrowRight" },
  closedWithoutAccompaniment: { label: "Cerrada sin acompañamiento", icon: "circleX" },
  cancelled: { label: "Cancelada", icon: "minus" },
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
        <AppIcon
          name={presentation.icon}
          testID={`student-request-status-icon-${presentation.icon}`}
          accessible={false}
          color="#0A7C70"
          size={22}
        />
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
