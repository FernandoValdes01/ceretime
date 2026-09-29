import type { UserIdentity } from "convex/server";
import { internal } from "./_generated/api";
import { env, internalMutation } from "./_generated/server";
import { assignAccompaniment } from "./application/accompaniments/commands";
import {
  acceptRequest,
  registerRequest,
  requestAdditionalInformation,
  takeRequest,
} from "./application/requests/commands";
import { findProfileByTokenIdentifier } from "./infrastructure/accompaniments/repository";

/**
 * Dataset ficticio mínimo del Sprint 1 (TI2-30).
 *
 * Se carga a mano en un deployment de desarrollo con `bunx convex run
 * fictitiousData:load`, siguiendo la guía de arranque del `README.md` raíz.
 * El inventario vive en `docs/dataset-ficticio.md`.
 */

// Emisor inventado: una sesión real produce `{CONVEX_SITE_URL}|{subject}`, así
// que ningún inicio de sesión coincide con estas cuentas ni puede usarlas.
const ISSUER = "dataset-ficticio";

const ACCOUNTS = {
  studentReceived: {
    subject: "estudiante-1",
    email: "estudiante.ficticio1@alu.uct.cl",
    fullName: "Estudiante Ficticio Uno",
    role: "student",
  },
  studentUnderReview: {
    subject: "estudiante-2",
    email: "estudiante.ficticio2@alu.uct.cl",
    fullName: "Estudiante Ficticio Dos",
    role: "student",
  },
  studentAwaiting: {
    subject: "estudiante-3",
    email: "estudiante.ficticio3@alu.uct.cl",
    fullName: "Estudiante Ficticio Tres",
    role: "student",
  },
  studentAccepted: {
    subject: "estudiante-4",
    email: "estudiante.ficticio4@alu.uct.cl",
    fullName: "Estudiante Ficticio Cuatro",
    role: "student",
  },
  professional: {
    subject: "profesional-1",
    email: "profesional.ficticio@uct.cl",
    fullName: "Profesional Ficticio",
    role: "professional",
  },
  intern: {
    subject: "practicante-1",
    email: "practicante.ficticio@alu.uct.cl",
    fullName: "Practicante Ficticio",
    role: "intern",
  },
} as const;

type AccountKey = keyof typeof ACCOUNTS;

function identityOf(key: AccountKey): UserIdentity {
  const { subject } = ACCOUNTS[key];
  return { issuer: ISSUER, subject, tokenIdentifier: `${ISSUER}|${subject}` };
}

/**
 * Carga el dataset una sola vez por deployment: si ya existe, no escribe
 * nada. Exige `TEST_SEEDS_ENABLED === "true"`, igual que `createTestUser`,
 * así que en producción se rechaza aunque alguien la ejecute a mano. No crea
 * administradores: el primero sale solo de `ensureBootstrapAdmin`.
 */
export const load = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (env.TEST_SEEDS_ENABLED !== "true") {
      throw new Error("Las semillas de prueba no están habilitadas en este entorno");
    }
    const marker = identityOf("studentReceived").tokenIdentifier;
    if ((await findProfileByTokenIdentifier(ctx, marker)) !== null) {
      return { loaded: false };
    }

    const createProfile = (key: AccountKey) =>
      ctx.runMutation(internal.users.createTestUser, {
        email: ACCOUNTS[key].email,
        fullName: ACCOUNTS[key].fullName,
        role: ACCOUNTS[key].role,
        institutionalStatus: "enabled",
        accountStatus: "active",
        tokenIdentifier: identityOf(key).tokenIdentifier,
      });
    for (const key of [
      "studentReceived",
      "studentUnderReview",
      "studentAwaiting",
      "studentAccepted",
      "professional",
    ] as const) {
      await createProfile(key);
    }
    const internId = await createProfile("intern");

    // Las solicitudes pasan por los casos de uso reales, con las identidades
    // ficticias: el dataset cumple las mismas reglas que el flujo del cliente.
    const professional = identityOf("professional");
    await registerRequest(ctx, identityOf("studentReceived"), {
      accessNeeds: "Material de clases en formato digital compatible con lector de pantalla.",
    });

    const underReview = await registerRequest(ctx, identityOf("studentUnderReview"), {
      accessNeeds: "Tiempo adicional en evaluaciones escritas.",
    });
    await takeRequest(ctx, professional, { requestId: underReview._id });

    const awaiting = await registerRequest(ctx, identityOf("studentAwaiting"), {
      accessNeeds: "Apoyo para organizar la entrega de trabajos del semestre.",
    });
    await takeRequest(ctx, professional, { requestId: awaiting._id });
    await requestAdditionalInformation(ctx, professional, {
      requestId: awaiting._id,
      reason: "Falta indicar en qué asignaturas se necesita el apoyo.",
    });

    const accepted = await registerRequest(ctx, identityOf("studentAccepted"), {
      accessNeeds: "Sala con acceso sin escaleras para las clases prácticas.",
    });
    await takeRequest(ctx, professional, { requestId: accepted._id });
    const accompaniment = await acceptRequest(ctx, professional, {
      requestId: accepted._id,
      objective: "Coordinar los apoyos de acceso para las clases prácticas del semestre.",
    });
    await assignAccompaniment(ctx, professional, {
      accompanimentId: accompaniment._id,
      userId: internId,
      assignedRole: "intern",
    });

    return { loaded: true };
  },
});
