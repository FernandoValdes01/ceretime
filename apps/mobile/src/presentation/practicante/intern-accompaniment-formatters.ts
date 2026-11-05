import type { InternAccompanimentStatus } from "../../application/intern-accompaniment-models";
import type { AppIconName } from "../components/app-icon";

export const internAccompanimentStatusLabels: Record<InternAccompanimentStatus, string> = {
  active: "Activo",
  paused: "En pausa",
  closed: "Cerrado",
};

export const internAccompanimentStatusMeta: Record<
  InternAccompanimentStatus,
  {
    readonly icon: Extract<AppIconName, "circleCheck" | "clock" | "circleX">;
    readonly tone: "success" | "warning" | "muted";
  }
> = {
  active: { tone: "success", icon: "circleCheck" },
  paused: { tone: "warning", icon: "clock" },
  closed: { tone: "muted", icon: "circleX" },
};
