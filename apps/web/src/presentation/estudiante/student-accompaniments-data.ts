import { useAction, useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Lecturas del acompañamiento propio del Estudiante (TI2-90) y acciones de
 * calendario por atención (TI2-122).
 *
 * Cableado delgado sobre la API pública: las queries responden `undefined`
 * mientras cargan y la autorización vive en Convex, que deniega con un error
 * genérico cuando el acompañamiento o la atención son ajenos. El `.ics` se
 * pide bajo demanda con el cliente de Convex para no descargar archivos en
 * cada render. Nunca se leen tokens ni la cuenta de Google: solo el booleano
 * de conexión y el contenido del archivo.
 */
export function useOwnAccompanimentDetail(accompanimentId: string) {
  return useQuery(api.presentation.accompaniments.getAccompaniment, {
    // El formato y la existencia los valida el Backend; un id inválido o
    // ajeno responde denegación genérica sin filtrar existencia.
    accompanimentId: accompanimentId as Id<"accompaniments">,
  });
}

/** Atenciones acotadas del acompañamiento, para las acciones de calendario. */
export function useOwnAccompanimentAppointments(accompanimentId: string) {
  return useQuery(api.presentation.appointments.listAccompanimentAppointments, {
    accompanimentId: accompanimentId as Id<"accompaniments">,
  });
}

/** Estado de la conexión de Google Calendar de la sesión (solo booleano). */
export function useCalendarConnection() {
  return useQuery(api.presentation.appointments.getCalendarConnection, {});
}

/** Acción explícita de agregar una atención al Google Calendar personal. */
export function useAddAppointmentToGoogleCalendar() {
  return useAction(api.presentation.appointments.addAppointmentToGoogleCalendar);
}

/**
 * Descarga bajo demanda del `.ics` de una atención. No es un hook de datos:
 * devuelve una función que consulta el archivo cuando la persona lo pide.
 */
export function useAppointmentCalendarFile() {
  const convex = useConvex();
  return async (appointmentId: string) =>
    await convex.query(api.presentation.appointments.getAppointmentCalendarFile, {
      appointmentId: appointmentId as Id<"appointments">,
    });
}

/** Detalle del acompañamiento propio, derivado del contrato generado (sin duplicar formas). */
export type OwnAccompanimentDetail = NonNullable<
  FunctionReturnType<typeof api.presentation.accompaniments.getAccompaniment>
>;

/** Resumen de atención del contrato generado. */
export type OwnAppointmentSummary = FunctionReturnType<
  typeof api.presentation.appointments.listAccompanimentAppointments
>[number];

/** Resultado de agregar una atención al calendario, derivado del contrato generado. */
export type AppointmentCalendarResult = FunctionReturnType<
  typeof api.presentation.appointments.addAppointmentToGoogleCalendar
>;

/** Archivo `.ics` de una atención, derivado del contrato generado. */
export type AppointmentCalendarFile = FunctionReturnType<
  typeof api.presentation.appointments.getAppointmentCalendarFile
>;
