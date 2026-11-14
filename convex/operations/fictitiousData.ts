import type { UserIdentity } from "convex/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { env, internalMutation } from "../_generated/server";
import { assignAccompaniment } from "../application/accompaniments/commands";
import {
  acceptRequest,
  registerRequest,
  requestAdditionalInformation,
  takeRequest,
} from "../application/requests/commands";
import { AGENDA_TIME_ZONE, civilRangeToInstantRange } from "../domain/availability/availability";
import { findProfileByTokenIdentifier } from "../infrastructure/accompaniments/repository";
import {
  appliedAccessNeedsFor,
  syncAppointmentProfessional,
} from "../infrastructure/appointments/repository";

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
 * Instante de una fecha y minuto civiles en la zona de la agenda que fija el
 * servidor. Las semillas no usan UTC directo: así los bloques, las excepciones
 * y las atenciones caen en el mismo horario civil que muestra la API.
 */
function agendaInstant(day: string, minuteOfDay: number): number {
  const { startAt } = civilRangeToInstantRange({ from: day, to: day, timeZone: AGENDA_TIME_ZONE });
  return startAt + minuteOfDay * 60_000;
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

    // Espacios ficticios de agenda. Las condiciones repiten, línea por línea,
    // la necesidad de acceso de la solicitud aceptada: así los cupos
    // presenciales son compatibles en la búsqueda real (TI2-82/TI2-97).
    const spaceId = await ctx.db.insert("spaces", {
      campus: "Norte",
      building: "C",
      floor: "2",
      room: "C-107",
      accessConditions: "Sala con acceso sin escaleras para las clases prácticas.",
      accessInstructions: "Entrada principal por el pasillo central del segundo piso.",
      isActive: true,
    });

    // Bloques recurrentes del profesional ficticio, en minutos civiles de la
    // zona de la agenda: lunes de 09:00 a 10:00 en línea y de 10:00 a 11:00
    // presencial en la sala C-107.
    await ctx.db.insert("availabilityBlocks", {
      professionalId,
      weekday: 1, // Lunes
      startMinute: 540, // 09:00 civil
      endMinute: 600, // 10:00 civil
      slotMinutes: 60,
      modality: "online",
      isActive: true,
    });
    const inPersonBlockId = await ctx.db.insert("availabilityBlocks", {
      professionalId,
      weekday: 1,
      startMinute: 600, // 10:00 civil
      endMinute: 660, // 11:00 civil
      slotMinutes: 60,
      modality: "inPerson",
      spaceId,
      isActive: true,
    });

    // Excepciones deterministas: una cancela el bloque presencial del lunes
    // 2026-10-12 (escenario incompatible) y otra agrega el sábado 2026-10-17
    // una ventana presencial de 10:00 a 11:00 (escenario compatible extra).
    await ctx.db.insert("availabilityExceptions", {
      professionalId,
      date: Date.UTC(2026, 9, 12),
      kind: "cancelled",
      blockId: inPersonBlockId,
      reason: "Bloque presencial cancelado para la demostración de excepciones.",
    });
    await ctx.db.insert("availabilityExceptions", {
      professionalId,
      date: Date.UTC(2026, 9, 17),
      kind: "added",
      startMinute: 600,
      endMinute: 660,
      slotMinutes: 60,
      modality: "inPerson",
      spaceId,
      reason: "Ventana adicional para la demostración de excepciones.",
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
    const granted = await assignAccompaniment(ctx, professional, {
      accompanimentId: accompaniment._id,
      userId: internId,
      assignedRole: "intern",
    });
    if (granted.status === "error") throw new Error(granted.error.message);

    // Atenciones deterministas, una por estado, en el cupo presencial de las
    // 10:00 civiles de cada lunes. La del 2026-10-12 coincide con el bloque
    // cancelado por la excepción; las demás, con el bloque recurrente. No
    // pasan por `occupySlotAtomically` porque la semilla incluye un cupo
    // cancelado a propósito, así que se insertan con la misma forma que esa
    // vía de escritura: copia congelada de necesidades y fila del profesional
    // responsable.
    const seededAt = agendaInstant("2026-09-21", 8 * 60);
    const attendance = (day: string) => ({
      accompanimentId: accompaniment._id,
      studentId: studentAcceptedId,
      professionalId,
      spaceId,
      modality: "inPerson" as const,
      startsAt: agendaInstant(day, 600),
      endsAt: agendaInstant(day, 660),
      createdAt: seededAt,
    });
    const appliedAccessNeeds = await appliedAccessNeedsFor(ctx, accompaniment._id);
    const seedAppointment = async (
      day: string,
      status: Doc<"appointments">["status"],
      cancelReason?: string,
    ) => {
      const row = attendance(day);
      const appointmentId = await ctx.db.insert("appointments", {
        ...row,
        status,
        ...(cancelReason === undefined ? {} : { cancelReason }),
        ...(appliedAccessNeeds === undefined ? {} : { appliedAccessNeeds }),
      });
      await syncAppointmentProfessional(ctx, {
        appointmentId,
        professionalId: row.professionalId,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      });
      return appointmentId;
    };

    await seedAppointment("2026-09-28", "no_show");
    await seedAppointment("2026-10-05", "completed");
    await seedAppointment(
      "2026-10-12",
      "cancelled_by_student",
      "Conflicto de horario imprevisto con otra actividad académica.",
    );
    await seedAppointment("2026-10-19", "scheduled");

    return { loaded: true };
  },
});
