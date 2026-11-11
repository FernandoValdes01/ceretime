import { createMobileConvexClient, type MobileConvexClient } from "../infrastructure/convex-client";
import {
  createDemoAuthAdapter,
  demoAuthCredentials,
  unassignedInternCredentials,
} from "../infrastructure/demo-auth-adapter";
import { createDemoAdministratorAccountsAdapter } from "../infrastructure/demo-administrator-accounts-adapter";
import { createDemoProfessionalAgendaReader } from "../infrastructure/demo-professional-agenda-reader";
import { createDemoProfessionalAccompanimentReader } from "../infrastructure/demo-professional-accompaniment-reader";
import { createDemoProfessionalAccompanimentStore } from "../infrastructure/demo-professional-accompaniment-data";
import { createDemoProfessionalReviewAdapter } from "../infrastructure/demo-professional-review-adapter";
import { createDemoInternAccompanimentReader } from "../infrastructure/demo-intern-accompaniment-reader";
import { createLocalAccessibilityPreferencesAdapter } from "../infrastructure/local-accessibility-preferences-adapter";
import { createNativeSpeechAdapter } from "../infrastructure/native-speech-adapter";
import { createNativeSpeechRecognitionAdapter } from "../infrastructure/native-speech-recognition-adapter";
import { createDemoStudentAreaReader } from "../infrastructure/demo-student-area-reader";
import { createDemoStudentRequestSubmitter } from "../infrastructure/demo-student-request-submitter";
import { createDemoStudentAreaStore } from "../infrastructure/demo-student-area-store";

type DemoReadMode = "success" | "empty" | "error";

// Las variables EXPO_PUBLIC_* permiten forzar estados vacíos, errores o demoras para probar la interfaz.
function readDemoMode(value: string | undefined): DemoReadMode {
  return value === "empty" || value === "error" ? value : "success";
}

function readDelayMs(value: string | undefined): number {
  const delay = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(delay) && delay > 0 ? delay : 0;
}

// Las claves públicas conservan «PRACTITIONER» para no romper los .env existentes.
const internDemoMode = process.env.EXPO_PUBLIC_PRACTITIONER_ACCOMPANIMENT_MODE;
const internDemoDelay = process.env.EXPO_PUBLIC_PRACTITIONER_ACCOMPANIMENT_DELAY_MS;

// Crea los adaptadores con datos de demostración; `resetDemo` los vuelve a crear para reiniciar el estado.
export function createDemoDataDependencies() {
  const demoStudentAreaStore = createDemoStudentAreaStore();
  const professionalAccompanimentStore = createDemoProfessionalAccompanimentStore();
  return {
    studentAreaReader: createDemoStudentAreaReader({
      delayMs: readDelayMs(process.env.EXPO_PUBLIC_STUDENT_AREA_DELAY_MS),
      mode: readDemoMode(process.env.EXPO_PUBLIC_STUDENT_AREA_DEMO_MODE),
      store: demoStudentAreaStore,
    }),
    studentRequestSubmitter: createDemoStudentRequestSubmitter({
      failureMode:
        process.env.EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE === "fail-once" ? "once" : "never",
      store: demoStudentAreaStore,
    }),
    administratorAccountsPort: createDemoAdministratorAccountsAdapter(),
    professionalAgendaReader: createDemoProfessionalAgendaReader(),
    professionalAccompanimentReader: createDemoProfessionalAccompanimentReader({
      delayMs: readDelayMs(process.env.EXPO_PUBLIC_PROFESSIONAL_ACCOMPANIMENT_DELAY_MS),
      mode: readDemoMode(process.env.EXPO_PUBLIC_PROFESSIONAL_ACCOMPANIMENT_MODE),
      store: professionalAccompanimentStore,
    }),
    professionalReviewPort: createDemoProfessionalReviewAdapter({
      accompanimentStore: professionalAccompanimentStore,
      studentStore: demoStudentAreaStore,
    }),
    internAccompanimentReader: createDemoInternAccompanimentReader({
      delayMs: readDelayMs(internDemoDelay),
      mode: readDemoMode(internDemoMode),
    }),
  };
}

// Punto único donde la app elige las implementaciones de cada puerto. Hoy todo es demostración local,
// salvo preferencias (AsyncStorage) y voz (módulos nativos); conectar Convex se hace aquí.
export const mobileDependencies = {
  ...createDemoDataDependencies(),
  accessibilityPreferencesPort: createLocalAccessibilityPreferencesAdapter(),
  speechPort: createNativeSpeechAdapter(),
  speechRecognitionPort: createNativeSpeechRecognitionAdapter(),
  authPort: createDemoAuthAdapter(),
  demoCredentials: demoAuthCredentials,
  unassignedInternCredentials,
  resetDemo(): void {
    Object.assign(mobileDependencies, createDemoDataDependencies());
  },
};

let convexClient: MobileConvexClient | undefined;

// Se crea al usarlo: la demostración local no requiere configurar un backend.
export function getMobileConvexClient(): MobileConvexClient {
  convexClient ??= createMobileConvexClient(process.env.EXPO_PUBLIC_CONVEX_URL);
  return convexClient;
}

type DataDependencies = ReturnType<typeof createDemoDataDependencies>;

export interface MobileConvexAdapterFactories {
  student(
    client: MobileConvexClient,
  ): Pick<DataDependencies, "studentAreaReader" | "studentRequestSubmitter">;
  professional(
    client: MobileConvexClient,
  ): Pick<
    DataDependencies,
    "professionalAgendaReader" | "professionalAccompanimentReader" | "professionalReviewPort"
  >;
  intern(client: MobileConvexClient): Pick<DataDependencies, "internAccompanimentReader">;
  administrator(client: MobileConvexClient): Pick<DataDependencies, "administratorAccountsPort">;
}

/** Las próximas issues aportan las fábricas reales; esta base no reemplaza los adaptadores demo. */
export function createConvexDataDependencies(
  factories: MobileConvexAdapterFactories,
): DataDependencies {
  const client = getMobileConvexClient();
  return {
    ...factories.student(client),
    ...factories.professional(client),
    ...factories.intern(client),
    ...factories.administrator(client),
  };
}
