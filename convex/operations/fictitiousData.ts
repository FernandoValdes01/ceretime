import type { UserIdentity } from "convex/server";
import { internal } from "../_generated/api";
import { env, internalMutation } from "../_generated/server";
import { assignAccompaniment } from "../application/accompaniments/commands";
import {
  acceptRequest,
  registerRequest,
  requestAdditionalInformation,
  takeRequest,
} from "../application/requests/commands";
import { findProfileByTokenIdentifier } from "../infrastructure/accompaniments/repository";

/**
 * Dataset ficticio mínimo del Sprint 1 (TI2-30).
 *
 * Se carga a mano en un deployment de desarrollo con `bunx convex run
 * operations/fictitiousData:load`, siguiendo la guía de arranque del `README.md` raíz.
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

    const createProfile = async (key: AccountKey) =>
      await ctx.runMutation(internal.operations.users.createTestUser, {
        email: ACCOUNTS[key].email,
        fullName: ACCOUNTS[key].fullName,
        role: ACCOUNTS[key].role,
        institutionalStatus: "enabled",
        accountStatus: "active",
        tokenIdentifier: identityOf(key).tokenIdentifier,
      });

    await createProfile("studentReceived");
    await createProfile("studentUnderReview");
    await createProfile("studentAwaiting");
    const studentAcceptedId = await createProfile("studentAccepted");
    const professionalId = await createProfile("professional");
    const internId = await createProfile("intern");

    // Espacios ficticios de agenda
    const spaceId = await ctx.db.insert("spaces", {
      campus: "Norte",
      building: "C",
      floor: "2",
      room: "C-107",
      accessConditions: "Acceso universal habilitado sin escaleras.",
      accessInstructions: "Entrada principal por el pasillo central del segundo piso.",
      isActive: true,
    });

    // Bloques de disponibilidad del profesional ficticio
    await ctx.db.insert("availabilityBlocks", {
      professionalId,
      weekday: 1, // Lunes
      startMinute: 540,
      endMinute: 600,
      slotMinutes: 60,
      modality: "online",
      isActive: true,
    });
    await ctx.db.insert("availabilityBlocks", {
      professionalId,
      weekday: 1,
      startMinute: 600,
      endMinute: 660,
      slotMinutes: 60,
      modality: "inPerson",
      spaceId,
      isActive: true,
    });

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

    // Atenciones ficticias con estados variados (programada, completada, cancelada, inasistencia)
    const slotStart = Date.UTC(2026, 9, 12, 9);
    const slotEnd = Date.UTC(2026, 9, 12, 10);
    const now = Date.now();

    await ctx.db.insert("appointments", {
      accompanimentId: accompaniment._id,
      studentId: studentAcceptedId,
      professionalId,
      modality: "online",
      status: "scheduled",
      startsAt: slotStart,
      endsAt: slotEnd,
      createdAt: now,
    });

    await ctx.db.insert("appointments", {
      accompanimentId: accompaniment._id,
      studentId: studentAcceptedId,
      professionalId,
      modality: "inPerson",
      spaceId,
      status: "completed",
      startsAt: slotStart + 3_600_000,
      endsAt: slotEnd + 3_600_000,
      createdAt: now,
    });

    await ctx.db.insert("appointments", {
      accompanimentId: accompaniment._id,
      studentId: studentAcceptedId,
      professionalId,
      modality: "online",
      status: "cancelled_by_student",
      cancelReason: "Conflicto de horario imprevisto con otra actividad académica.",
      startsAt: slotStart + 2 * 3_600_000,
      endsAt: slotEnd + 2 * 3_600_000,
      createdAt: now,
    });

    await ctx.db.insert("appointments", {
      accompanimentId: accompaniment._id,
      studentId: studentAcceptedId,
      professionalId,
      modality: "online",
      status: "no_show",
      startsAt: slotStart + 3 * 3_600_000,
      endsAt: slotEnd + 3 * 3_600_000,
      createdAt: now,
    });

    return { loaded: true };
  },
});
