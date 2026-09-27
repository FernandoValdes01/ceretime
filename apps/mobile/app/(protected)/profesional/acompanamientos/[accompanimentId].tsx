import { useLocalSearchParams } from "expo-router";

import { ProfessionalPlaceholderScreen } from "../../../../src/presentation/profesional/professional-placeholder-screen";

export default function ProfessionalAccompanimentDetailRoute() {
  const { accompanimentId } = useLocalSearchParams<{ accompanimentId?: string | string[] }>();
  const selectedId = Array.isArray(accompanimentId) ? accompanimentId[0] : accompanimentId;

  return (
    <ProfessionalPlaceholderScreen
      title="Acompañamiento seleccionado"
      description={`Identificador del acompañamiento: ${selectedId ?? "no disponible"}. El detalle estará disponible en la siguiente tarea.`}
    />
  );
}
