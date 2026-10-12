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
    readonly icon: Extract<AppIconName, "circleCheck" | "clock" | "circleX">;
    readonly tone: "success" | "warning" | "muted";
  }
> = {
  active: { tone: "success", icon: "circleCheck" },
  paused: { tone: "warning", icon: "clock" },
  closed: { tone: "muted", icon: "circleX" },
};
