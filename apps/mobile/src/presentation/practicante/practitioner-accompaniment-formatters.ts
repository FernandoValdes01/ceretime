import type { PractitionerAccompanimentStatus } from "../../application/practitioner-accompaniment-models";
import type { AppIconName } from "../components/app-icon";

export const practitionerAccompanimentStatusLabels: Record<
  PractitionerAccompanimentStatus,
  string
> = {
  active: "Activo",
  paused: "En pausa",
  closed: "Cerrado",
};

export const practitionerAccompanimentStatusMeta: Record<
  PractitionerAccompanimentStatus,
  {
    readonly backgroundColor: string;
    readonly color: string;
    readonly icon: Extract<AppIconName, "circleCheck" | "clock" | "circleX">;
  }
> = {
  active: { backgroundColor: "#E8F4F1", color: "#087D70", icon: "circleCheck" },
  paused: { backgroundColor: "#FFF3D8", color: "#8A5A00", icon: "clock" },
  closed: { backgroundColor: "#EEF2F1", color: "#5B6C6E", icon: "circleX" },
};
