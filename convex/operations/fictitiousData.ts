import type { UserIdentity } from "convex/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { env, internalMutation } from "../_generated/server";
import { assignAccompaniment } from "../application/accompaniments/commands";
import {
  acceptRequest,
  registerRequest,
  requestAdditionalInformation,
  takeRequest,
} from "../application/requests/commands";
import { AGENDA_TIME_ZONE, civilRangeToInstantRange } from "../domain/availability/availability";
import type { ApiResult } from "../domain/errors/api_error";
import {
  accompanimentOpener,
  findProfileByTokenIdentifier,
} from "../infrastructure/accompaniments/repository";
import {
  activeProfessionalReader,
  activeStudentReader,
  requestStore,
} from "../infrastructure/requests/repository";
import { syncAppointmentProfessional } from "../infrastructure/appointments/repository";
import { internalNotificationEventRecorder } from "../infrastructure/notifications/repository";

/**
 * Dataset ficticio mínimo del Sprint 1 (TI2-30).
 *
 * Se carga a mano en un deployment de desarrollo con `bunx convex run
 * operations/fictitiousData:load`, siguiendo la guía de arranque del `README.md` raíz.
 * El inventario vive en `docs/dataset-ficticio.md`.
 */

/** La carga usa la forma anterior, que lanza sus rechazos: un error aquí es un dataset roto. */
function registered<T>(result: ApiResult<T>): T {
  if (result.status === "error") throw new Error(result.error.message);
  return result.data;
}

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
    });

    // Las solicitudes pasan por los casos de uso reales, con las identidades
    // ficticias: el dataset cumple las mismas reglas que el flujo del cliente.
    const professional = identityOf("professional");
    const asProfessional = {
      professionals: activeProfessionalReader(ctx),
      requests: requestStore(ctx),
      accompaniments: accompanimentOpener(ctx),
      notifications: internalNotificationEventRecorder(ctx),
      now: Date.now,
    };
    const tokenIdentifier = professional.tokenIdentifier;
    const take = async (requestId: Id<"requests">) =>
      registered(await takeRequest(asProfessional, { tokenIdentifier, requestId }));
    const register = async (student: AccountKey, accessNeeds: string) =>
      registered(
        await registerRequest(
          {
            students: activeStudentReader(ctx),
            requests: requestStore(ctx),
            notifications: internalNotificationEventRecorder(ctx),
            now: Date.now,
          },
          { tokenIdentifier: identityOf(student).tokenIdentifier, submission: { accessNeeds } },
        ),
      );
    await register(
      "studentReceived",
      "Material de clases en formato digital compatible con lector de pantalla.",
    );

    const underReview = await register(
      "studentUnderReview",
      "Tiempo adicional en evaluaciones escritas.",
    );
    await take(underReview._id);

    const awaiting = await register(
      "studentAwaiting",
      "Apoyo para organizar la entrega de trabajos del semestre.",
    );
    await take(awaiting._id);
    registered(
      await requestAdditionalInformation(asProfessional, {
        tokenIdentifier,
        requestId: awaiting._id,
        reason: "Falta indicar en qué asignaturas se necesita el apoyo.",
      }),
    );

    const accepted = await register(
      "studentAccepted",
      "Sala con acceso sin escaleras para las clases prácticas.",
    );
    await take(accepted._id);
    const accompaniment = registered(
      await acceptRequest(asProfessional, {
        tokenIdentifier,
        requestId: accepted._id,
        objective: "Coordinar los apoyos de acceso para las clases prácticas del semestre.",
      }),
    );
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
    // vía de escritura, con la fila del profesional responsable.
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
      });
      await syncAppointmentProfessional(ctx, {
        appointmentId,
        professionalId: row.professionalId,
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

/**
 * Muestra ficticia determinista para reportes agregados (TI2-175).
 *
 * Genera grupos por encima (>= 5) y por debajo (< 5) del umbral mínimo en
 * octubre de 2026 para comprobar en pantalla y exportación tanto la supresión
 * primaria como la supresión complementaria. Es idempotente y exige
 * `TEST_SEEDS_ENABLED === "true"`.
 */
export const loadReportSamples = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (env.TEST_SEEDS_ENABLED !== "true") {
      throw new Error("Las semillas de prueba no están habilitadas en este entorno");
    }

    const markerToken = `${ISSUER}|reportes-estudiante-1`;
    if ((await findProfileByTokenIdentifier(ctx, markerToken)) !== null) {
      return { loaded: false };
    }

    const professionalId =
      (await findProfileByTokenIdentifier(ctx, identityOf("professional").tokenIdentifier))?._id ??
      (await ctx.runMutation(internal.operations.users.createTestUser, {
        email: ACCOUNTS.professional.email,
        fullName: ACCOUNTS.professional.fullName,
        role: "professional",
        institutionalStatus: "enabled",
        accountStatus: "active",
        tokenIdentifier: identityOf("professional").tokenIdentifier,
      }));

    const studentIds: Id<"users">[] = [];
    for (let index = 1; index <= 6; index += 1) {
      const id = await ctx.runMutation(internal.operations.users.createTestUser, {
        email: `reportes.estudiante${index}@alu.uct.cl`,
        fullName: `Estudiante Reporte Ficticio ${index}`,
        role: "student",
        institutionalStatus: "enabled",
        accountStatus: "active",
        tokenIdentifier: `${ISSUER}|reportes-estudiante-${index}`,
      });
      studentIds.push(id);
    }

    const primaryStudentId = studentIds[0] as Id<"users">;
    const accompanimentId = await ctx.db.insert("accompaniments", {
      studentId: primaryStudentId,
      status: "active",
      objective: "Acompañamiento ficticio para pruebas de reportes agregados.",
      accessNeeds: "Material digital accesible.",
    });

    const baseCreatedAt = agendaInstant("2026-10-02", 9 * 60);

    // Solicitudes:
    // - 6 `accepted` (sobre umbral 5) con primera transición determinista (2h..7h)
    // - 5 `under_review` (en umbral 5) con primera transición determinista
    // - 2 `received` (bajo umbral 5 -> supresión primaria, activa complementaria sobre `under_review`)
    for (let i = 0; i < 6; i += 1) {
      const createdAt = baseCreatedAt + i * 3_600_000;
      const reqId = await ctx.db.insert("requests", {
        studentId: studentIds[i % studentIds.length] as Id<"users">,
        status: "accepted",
        accessNeeds: "Apoyo ficticio para pruebas agregadas.",
        createdAt,
      });
      await ctx.db.insert("requestTransitions", {
        requestId: reqId,
        from: "received",
        to: "under_review",
        actorId: professionalId,
        occurredAt: createdAt + (i + 2) * 3_600_000,
      });
    }

    for (let i = 0; i < 5; i += 1) {
      const createdAt = baseCreatedAt + (i + 10) * 3_600_000;
      const reqId = await ctx.db.insert("requests", {
        studentId: studentIds[i % studentIds.length] as Id<"users">,
        status: "under_review",
        accessNeeds: "Apoyo ficticio en revisión.",
        createdAt,
      });
      await ctx.db.insert("requestTransitions", {
        requestId: reqId,
        from: "received",
        to: "under_review",
        actorId: professionalId,
        occurredAt: createdAt + 4 * 3_600_000,
      });
    }

    for (let i = 0; i < 2; i += 1) {
      await ctx.db.insert("requests", {
        studentId: studentIds[i % studentIds.length] as Id<"users">,
        status: "received",
        accessNeeds: "Apoyo ficticio recién recibido.",
        createdAt: baseCreatedAt + (i + 20) * 3_600_000,
      });
    }

    // Atenciones en octubre de 2026:
    // - 6 completed online (>= 5)
    // - 5 completed inPerson (>= 5)
    // - 5 no_show online (>= 5)
    // - 2 cancelled_by_student inPerson (< 5 -> supresión primaria + complementaria)
    const insertAppointment = async (
      day: string,
      minuteOffset: number,
      status: Doc<"appointments">["status"],
      modality: "inPerson" | "online",
    ) => {
      const startsAt = agendaInstant(day, 9 * 60 + minuteOffset);
      const appointmentId = await ctx.db.insert("appointments", {
        accompanimentId,
        studentId: primaryStudentId,
        professionalId,
        modality,
        status,
        startsAt,
        endsAt: startsAt + 45 * 60_000,
        createdAt: baseCreatedAt,
      });
      await syncAppointmentProfessional(ctx, { appointmentId, professionalId });
    };

    for (let i = 0; i < 6; i += 1) {
      await insertAppointment("2026-10-06", i * 60, "completed", "online");
    }
    for (let i = 0; i < 5; i += 1) {
      await insertAppointment("2026-10-07", i * 60, "completed", "inPerson");
    }
    for (let i = 0; i < 5; i += 1) {
      await insertAppointment("2026-10-08", i * 60, "no_show", "online");
    }
    for (let i = 0; i < 2; i += 1) {
      await insertAppointment("2026-10-09", i * 60, "cancelled_by_student", "inPerson");
    }

    return { loaded: true };
  },
});
