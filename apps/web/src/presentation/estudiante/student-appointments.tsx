import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { authClient } from "../../infrastructure/auth/auth-client.ts";
import {
  getCalendarLinkRequest,
  type CalendarCallbackStatus,
} from "../../application/calendar/calendar-link.ts";
import {
  appointmentStatusLabel,
  formatAppointmentDateTime,
  isCalendarActionableStatus,
  modalityLabel,
} from "./agenda-labels.ts";
import { downloadCalendarFile, type DownloadableCalendarFile } from "./calendar-download.ts";
import {
  useAddAppointmentToGoogleCalendar,
  useAppointmentCalendarFile,
  useCalendarConnection,
  useOwnAccompanimentAppointments,
  type OwnAppointmentSummary,
} from "./student-accompaniments-data.ts";

/**
 * Atenciones del acompañamiento y acciones de calendario (TI2-122).
 *
 * La sección es explícita: primero muestra el estado real de la conexión de
 * Google Calendar y luego ofrece, por atención programada o reagendada,
 * agregarla al calendario o descargar el `.ics`. Un fallo del proveedor nunca
 * oculta la atención ni revierte la reserva: se muestra un aviso genérico y el
 * archivo de respaldo. No se leen calendarios ni se muestran tokens, correo de
 * Google o detalles del proveedor.
 */

type Notice = {
  readonly kind: "success" | "error" | "info";
  readonly text: string;
};

const NOTICE_STYLES: Record<Notice["kind"], string> = {
  success: "border-primary bg-surface-container-low text-on-surface",
  error: "border-error bg-surface-container-low text-on-surface",
  info: "border-secondary-container bg-surface-container-low text-on-surface-variant",
};

function NoticeBox({ notice }: { notice: Notice }) {
  return (
    <p
      role={notice.kind === "error" ? "alert" : "status"}
      className={`rounded-lg border-t-4 p-4 text-sm ${NOTICE_STYLES[notice.kind]}`}
    >
      {notice.text}
    </p>
  );
}

function calendarCallbackNotice(status?: CalendarCallbackStatus): Notice | null {
  if (status === "connected") {
    return {
      kind: "success",
      text: "Google Calendar quedó conectado. Ya puedes agregar tus atenciones.",
    };
  }
  if (status === "error") {
    return {
      kind: "error",
      text: "No pudimos conectar Google Calendar. Puedes intentarlo de nuevo o descargar el archivo .ics.",
    };
  }
  return null;
}

export function StudentAppointmentsSection({
  accompanimentId,
  calendarStatus,
  readOnly = false,
}: {
  accompanimentId: string;
  calendarStatus?: CalendarCallbackStatus;
  readOnly?: boolean;
}) {
  const appointments = useOwnAccompanimentAppointments(accompanimentId);
  const connection = useCalendarConnection();
  const addToCalendar = useAddAppointmentToGoogleCalendar();
  const getCalendarFile = useAppointmentCalendarFile();

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState<Notice | null>(null);
  const [callbackDismissed, setCallbackDismissed] = useState(false);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [fallbackFiles, setFallbackFiles] = useState<Record<string, DownloadableCalendarFile>>({});

  const callbackNotice = callbackDismissed ? null : calendarCallbackNotice(calendarStatus);
  const visibleConnectionNotice = connectionNotice ?? callbackNotice;

  function setAppointmentNotice(appointmentId: string, notice: Notice) {
    setNotices((current) => ({ ...current, [appointmentId]: notice }));
  }

  async function handleConnect() {
    setConnecting(true);
    setConnectionNotice(null);
    setCallbackDismissed(true);
    try {
      const result = await authClient.linkSocial(
        getCalendarLinkRequest(`${window.location.pathname}${window.location.search}`),
      );
      if (result.error) {
        setConnectionNotice({
          kind: "error",
          text: "No pudimos conectar Google Calendar. Inténtalo de nuevo.",
        });
      }
    } catch {
      setConnectionNotice({
        kind: "error",
        text: "No pudimos conectar Google Calendar. Inténtalo de nuevo.",
      });
    } finally {
      setConnecting(false);
    }
  }

  async function handleDownload(appointmentId: string) {
    setDownloadingId(appointmentId);
    try {
      const file = await getCalendarFile(appointmentId);
      downloadCalendarFile(file);
      setAppointmentNotice(appointmentId, {
        kind: "success",
        text: "Descargamos el archivo .ics de esta atención.",
      });
    } catch {
      setAppointmentNotice(appointmentId, {
        kind: "error",
        text: "No pudimos descargar el archivo .ics. Inténtalo de nuevo.",
      });
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleAdd(appointment: OwnAppointmentSummary) {
    const appointmentId = appointment.appointmentId;
    setPendingId(appointmentId);
    try {
      const result = await addToCalendar({ appointmentId });
      if (result.status === "fallback") {
        setFallbackFiles((current) => ({ ...current, [appointmentId]: result.ics }));
        setAppointmentNotice(appointmentId, {
          kind: "info",
          text: "No pudimos agregar la atención a Google Calendar. Puedes descargar el archivo .ics de respaldo.",
        });
        return;
      }
      setAppointmentNotice(appointmentId, {
        kind: "success",
        text:
          result.status === "already_created"
            ? "Esta atención ya estaba en tu Google Calendar."
            : "Agregamos la atención a tu Google Calendar.",
      });
    } catch {
      setAppointmentNotice(appointmentId, {
        kind: "error",
        text: "No pudimos agregar la atención a Google Calendar. Inténtalo de nuevo o descarga el archivo .ics.",
      });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section aria-labelledby="student-appointments-title" className="flex flex-col gap-4">
      <h2 id="student-appointments-title" className="text-2xl font-semibold text-primary">
        Atenciones
      </h2>
      <p className="text-base text-on-surface-variant">
        {readOnly
          ? "Este acompañamiento está cerrado: las atenciones se muestran en solo lectura, sin acciones de calendario."
          : "Puedes agregar cada atención programada a tu Google Calendar o descargar un archivo .ics para importarlo en el calendario que prefieras."}
      </p>

      {readOnly ? null : visibleConnectionNotice === null ? null : (
        <NoticeBox notice={visibleConnectionNotice} />
      )}

      {readOnly ? null : connection === undefined ? (
        <p role="status" className="text-sm text-on-surface-variant">
          Verificando la conexión con Google Calendar…
        </p>
      ) : connection.connected ? (
        <p className="text-sm text-on-surface-variant">Google Calendar está conectado.</p>
      ) : (
        <div className="rounded-lg border border-border-low bg-surface-container-lowest p-6">
          <p className="mb-2 font-semibold text-on-surface">Google Calendar no está conectado.</p>
          <p className="mb-4 text-sm text-on-surface-variant">
            Conectar tu cuenta permite crear el evento automáticamente. Google pedirá permiso sobre
            los eventos de tu calendario; la app solo lo usa para crear esta atención y no lista ni
            sincroniza tu calendario. También puedes descargar el archivo .ics.
          </p>
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={connecting}
            aria-busy={connecting}
            className="min-h-[44px] rounded-[0.5rem] bg-primary px-4 py-2 font-semibold text-on-primary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60"
          >
            {connecting ? "Conectando…" : "Conectar Google Calendar"}
          </button>
        </div>
      )}

      {appointments === undefined ? (
        <p role="status" className="text-base text-on-surface-variant">
          Cargando tus atenciones…
        </p>
      ) : appointments.length === 0 ? (
        <p className="text-base text-on-surface-variant">
          Aún no tienes atenciones registradas en este acompañamiento.
        </p>
      ) : (
        <ul className="flex list-none flex-col gap-4 p-0">
          {appointments.map((appointment) => (
            <AppointmentItem
              key={appointment.appointmentId}
              appointment={appointment}
              connected={connection?.connected === true}
              readOnly={readOnly}
              pending={pendingId === appointment.appointmentId}
              downloading={downloadingId === appointment.appointmentId}
              notice={notices[appointment.appointmentId]}
              fallbackFile={fallbackFiles[appointment.appointmentId]}
              onAdd={() => void handleAdd(appointment)}
              onDownload={() => void handleDownload(appointment.appointmentId)}
            />
          ))}
        </ul>
      )}

      <p className="text-sm text-on-surface-variant">
        Si necesitas cambiar o cancelar una atención, usa los canales oficiales de CERETI.{" "}
        <Link to="/estudiante" className="underline">
          Volver al inicio
        </Link>
        .
      </p>
    </section>
  );
}

function AppointmentItem({
  appointment,
  connected,
  readOnly,
  pending,
  downloading,
  notice,
  fallbackFile,
  onAdd,
  onDownload,
}: {
  appointment: OwnAppointmentSummary;
  connected: boolean;
  readOnly: boolean;
  pending: boolean;
  downloading: boolean;
  notice?: Notice;
  fallbackFile?: DownloadableCalendarFile;
  onAdd: () => void;
  onDownload: () => void;
}) {
  const actionable = isCalendarActionableStatus(appointment.status);
  const dateLabel = formatAppointmentDateTime(appointment.startAt, appointment.endAt);

  return (
    <li className="rounded-lg border border-border-low bg-surface-container-lowest p-6">
      <p className="mb-1 font-semibold text-on-surface">{dateLabel}</p>
      <p className="mb-3 text-sm text-on-surface-variant">
        {appointmentStatusLabel(appointment.status)} · {modalityLabel(appointment.modality)}
        {appointment.calendarAdded ? " · Agregada a Google Calendar" : ""}
      </p>

      {notice === undefined ? null : <NoticeBox notice={notice} />}

      {readOnly ? null : (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            aria-busy={downloading}
            aria-label={`Descargar el archivo .ics de la atención del ${dateLabel}`}
            className="min-h-[44px] rounded-[0.5rem] border border-primary px-4 py-2 font-semibold text-primary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60"
          >
            {downloading ? "Descargando…" : "Descargar .ics"}
          </button>

          {actionable && connected && !appointment.calendarAdded ? (
            <button
              type="button"
              onClick={onAdd}
              disabled={pending}
              aria-busy={pending}
              aria-label={`Agregar a Google Calendar la atención del ${dateLabel}`}
              className="min-h-[44px] rounded-[0.5rem] bg-primary px-4 py-2 font-semibold text-on-primary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60"
            >
              {pending ? "Agregando…" : "Agregar a Google Calendar"}
            </button>
          ) : null}

          {fallbackFile === undefined ? null : (
            <button
              type="button"
              onClick={() => downloadCalendarFile(fallbackFile)}
              className="min-h-[44px] rounded-[0.5rem] border border-primary px-4 py-2 font-semibold text-primary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Descargar .ics de respaldo
            </button>
          )}
        </div>
      )}
    </li>
  );
}
