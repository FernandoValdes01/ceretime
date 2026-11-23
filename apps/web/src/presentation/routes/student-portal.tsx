import { Component, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { REQUEST_PROCESS_STEPS } from "../estudiante/request-process.ts";
import { Speakable } from "../accessibility/Speakable.tsx";
import {
  accompanimentStatusLabel,
  formatPanelDate,
  requestStatusLabel,
} from "./student-panel-labels.ts";
import {
  useStudentAccompaniments,
  useStudentRequests,
  useStudentSession,
} from "./student-panel-data.ts";
import { AppShell } from "./app-shell.tsx";
import "./student-portal.css";

/**
 * Estructura del portal del Estudiante (TI2-6, TI2-133, TI2-182).
 *
 * La navegación común vive en `AppShell`: marca el inicio, las pantallas
 * reales del rol y el cierre de sesión. Las vistas cuelgan de este layout
 * tras el mismo guard. Una cuenta sin perfil habilitado y vigente ve su
 * estado en lugar de cada vista: el Backend denegaría todas sus lecturas y
 * cada pantalla mostraría un error de carga. Si el perfil no pudo crearse por
 * un fallo pasajero, se ofrece reintentar en vez de declarar la cuenta no
 * habilitada.
 */
export function StudentLayout({
  account,
  onRetry,
}: {
  account: "enabled" | "not-enabled" | "unavailable";
  onRetry: () => void;
}) {
  if (account === "enabled") return <AppShell area="student" />;
  return (
    <AppShell area="student">
      {account === "unavailable" ? (
        <StudentAccountUnavailable onRetry={onRetry} />
      ) : (
        <StudentAccountNotEnabled />
      )}
    </AppShell>
  );
}

/**
 * La cuenta aún no tiene perfil porque su creación falló por una causa
 * pasajera (TI2-182): no es un estado de la cuenta, así que se ofrece
 * reintentar sin salir del portal.
 */
function StudentAccountUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <section aria-labelledby="student-unavailable-title" className="student-portal__head">
      <span className="student-portal__badge">Estudiante acompañado</span>
      <h1 id="student-unavailable-title">Portal del Estudiante</h1>
      <p role="alert" className="student-portal__error">
        No pudimos preparar tu cuenta. Inténtalo de nuevo.
      </p>
      <div className="student-portal__cta">
        <button
          type="button"
          className="student-portal__btn student-portal__btn--primary"
          onClick={onRetry}
        >
          Reintentar
        </button>
      </div>
    </section>
  );
}

/**
 * Estado de una cuenta de estudiante que no puede operar. Las cuentas
 * `@alu.uct.cl` nacen habilitadas, así que este estado corresponde a una
 * cuenta revocada o inactiva, o a una que no pudo obtener su perfil.
 */
function StudentAccountNotEnabled() {
  return (
    <section aria-labelledby="student-not-enabled-title" className="student-portal__head">
      <span className="student-portal__badge">Estudiante acompañado</span>
      <h1 id="student-not-enabled-title">Tu cuenta no está habilitada</h1>
      <p className="student-portal__lead">
        Por ahora no puedes usar el portal del Estudiante con esta cuenta. Si crees que es un error,
        comunícate con CERETI por sus canales oficiales.
      </p>
    </section>
  );
}

/**
 * Panel inicial del Estudiante: resumen con datos propios (tarea Portal Web
 * Estudiante). Consume solo queries públicas ya existentes (identidad,
 * solicitudes propias y acompañamientos propios); la autorización vive en
 * Convex. Sin datos muestra vacíos explícitos; las vistas funcionales
 * completas siguen en Sprint 2.
 */
export function StudentHome() {
  return (
    <StudentPanelErrorBoundary subject="tu resumen" level="page">
      <StudentPanelContent />
    </StudentPanelErrorBoundary>
  );
}

/**
 * Límite de error reutilizable: ante una query caída muestra el aviso y un
 * reintento acotado a su nivel, sin contenido protegido. El nivel `page`
 * titula con h1; el nivel `section` no repite encabezados.
 */
export class StudentPanelErrorBoundary extends Component<
  {
    children: ReactNode;
    subject: string;
    level: "page" | "section";
    /**
     * Vista propia ante un error. Recibe el motivo (`subject`) y cómo
     * reintentar; si no se indica, conserva el aviso rojo común. Permite que
     * un área use otro lenguaje visual sin duplicar el límite.
     */
    fallback?: (args: { subject: string; retry: () => void }) => ReactNode;
  },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        const retry = () => this.setState({ hasError: false });
        return <>{this.props.fallback({ subject: this.props.subject, retry })}</>;
      }
      if (this.props.level === "section") {
        return (
          <div>
            <p role="alert" className="student-portal__error">
              No pudimos cargar {this.props.subject}. Inténtalo de nuevo.
            </p>
            <div className="student-portal__cta">
              <button
                type="button"
                className="student-portal__btn student-portal__btn--primary"
                onClick={() => this.setState({ hasError: false })}
              >
                Reintentar
              </button>
            </div>
          </div>
        );
      }
      return (
        <section aria-labelledby="student-panel-error-title" className="student-portal__head">
          <h1 id="student-panel-error-title">Portal del Estudiante</h1>
          <p role="alert" className="student-portal__error">
            No pudimos cargar {this.props.subject}. Inténtalo de nuevo.
          </p>
          <div className="student-portal__cta">
            <button
              type="button"
              className="student-portal__btn student-portal__btn--primary"
              onClick={() => this.setState({ hasError: false })}
            >
              Reintentar
            </button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

function StudentPanelContent() {
  const session = useStudentSession();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const ready = session !== undefined;

  useEffect(() => {
    if (ready) {
      headingRef.current?.focus();
    }
  }, [ready]);

  if (!ready) {
    return (
      <section aria-labelledby="student-home-title" className="student-portal__head">
        <span className="student-portal__badge">Estudiante acompañado</span>
        <h1 id="student-home-title">Portal del Estudiante</h1>
        <p role="status" className="student-portal__loading">
          Cargando tu resumen…
        </p>
      </section>
    );
  }

  if (session.status === "unauthenticated") {
    return (
      <section aria-labelledby="student-home-title" className="student-portal__head">
        <span className="student-portal__badge">Estudiante acompañado</span>
        <h1 id="student-home-title">Portal del Estudiante</h1>
        <p className="student-portal__lead">
          Vuelve al acceso e inicia sesión para ver tu resumen.
        </p>
      </section>
    );
  }

  return (
    <>
      <section aria-labelledby="student-home-title" className="student-portal__head">
        <span className="student-portal__badge">Estudiante acompañado</span>
        <h1 id="student-home-title" ref={headingRef} tabIndex={-1}>
          Portal del Estudiante
        </h1>
        <Speakable
          text={`Hola, ${session.name}. Aquí verás el estado de tus solicitudes y acompañamientos.`}
          className="student-portal__lead"
        >
          Hola, <strong>{session.name}</strong>. Aquí verás el estado de tus solicitudes y
          acompañamientos.
        </Speakable>
        <div className="student-portal__cta">
          <Link
            to="/estudiante/solicitudes/nueva"
            className="student-portal__btn student-portal__btn--primary"
          >
            Solicitar acompañamiento
          </Link>
          <a href="#como-funciona" className="student-portal__btn student-portal__btn--ghost">
            Cómo funciona
          </a>
        </div>
      </section>

      <section
        aria-labelledby="como-funciona-title"
        id="como-funciona"
        className="student-portal__section"
      >
        <h2 id="como-funciona-title">Cómo funciona el acompañamiento</h2>
        <ol className="student-portal__steps">
          {REQUEST_PROCESS_STEPS.map((step, index) => (
            <li key={step.title} className="student-portal__step">
              <span className="student-portal__step-num" aria-hidden="true">
                {index + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <StudentRequestsSection />

      <StudentAccompanimentsSection />

      <section aria-labelledby="student-attentions-title" className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id="student-attentions-title">Atenciones</h2>
        </div>
        <div className="student-portal__empty student-portal__empty--blue">
          <p className="student-portal__empty-title">Revisa tus atenciones y su estado.</p>
          <div className="student-portal__cta">
            <Link
              to="/estudiante/atenciones"
              className="student-portal__btn student-portal__btn--ghost"
            >
              Ver mis atenciones
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="student-agreements-title" className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id="student-agreements-title">Acuerdos y tareas</h2>
          <span className="student-portal__soon">Próximamente</span>
        </div>
        <div className="student-portal__empty student-portal__empty--green">
          <p className="student-portal__empty-title">Aún no tienes acuerdos ni tareas.</p>
          <p>Los acuerdos y las tareas de tus atenciones estarán disponibles aquí.</p>
        </div>
      </section>

      <section aria-labelledby="student-access-needs-title" className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id="student-access-needs-title">Necesidades de acceso</h2>
          <span className="student-portal__soon">Próximamente</span>
        </div>
        <div className="student-portal__empty">
          <p className="student-portal__empty-title">Aún no registras necesidades de acceso.</p>
          <p>Podrás actualizarlas y se aplicarán a tus atenciones futuras.</p>
        </div>
      </section>

      <section aria-labelledby="student-privacy-title" className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id="student-privacy-title">Solicitudes de privacidad</h2>
          <span className="student-portal__soon">Próximamente</span>
        </div>
        <div className="student-portal__empty student-portal__empty--blue">
          <p className="student-portal__empty-title">Sin solicitudes de privacidad.</p>
          <p>Podrás pedir acceso, corrección, bloqueo, exportación o supresión de tus datos.</p>
        </div>
      </section>
    </>
  );
}

/** Sección de solicitudes propias con sus estados de carga, vacío y éxito. */
function StudentRequestsSection() {
  return (
    <section aria-labelledby="student-requests-title" className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id="student-requests-title">Solicitudes</h2>
      </div>
      <StudentPanelErrorBoundary subject="tus solicitudes" level="section">
        <StudentRequestsBody />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function StudentRequestsBody() {
  const requests = useStudentRequests();

  if (requests === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando tus solicitudes…
      </p>
    );
  }

  if (requests.page.length === 0) {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">Aún no tienes solicitudes registradas.</p>
        <p>Cuando envíes tu primera solicitud, aparecerá aquí con su estado.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="student-portal__list">
        {requests.page.map((request) => (
          <li key={request._id} className="student-portal__item">
            <span className="student-portal__chip">{requestStatusLabel(request.status)}</span>
            <span className="student-portal__item-meta">
              Registrada el {formatPanelDate(request.createdAt)}
            </span>
          </li>
        ))}
      </ul>
      {requests.isDone ? null : (
        <p className="student-portal__hint">Mostrando las más recientes.</p>
      )}
    </>
  );
}

/** Sección de acompañamientos propios con sus estados de carga, vacío y éxito. */
function StudentAccompanimentsSection() {
  return (
    <section aria-labelledby="student-accompaniments-title" className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id="student-accompaniments-title">Acompañamientos</h2>
      </div>
      <StudentPanelErrorBoundary subject="tus acompañamientos" level="section">
        <StudentAccompanimentsBody />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function StudentAccompanimentsBody() {
  const accompaniments = useStudentAccompaniments();

  if (accompaniments === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando tus acompañamientos…
      </p>
    );
  }

  if (accompaniments.page.length === 0) {
    return (
      <div className="student-portal__empty student-portal__empty--green">
        <p className="student-portal__empty-title">Aún no tienes acompañamientos asignados.</p>
        <p>Cuando un profesional te asigne un acompañamiento, lo verás aquí.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="student-portal__list">
        {accompaniments.page.map((accompaniment) => (
          <li key={accompaniment._id} className="student-portal__item">
            <Link
              to="/estudiante/acompanamientos/$accompanimentId"
              params={{ accompanimentId: accompaniment._id }}
              className="student-portal__item-link"
            >
              <span className="student-portal__chip">
                {accompanimentStatusLabel(accompaniment.status)}
              </span>
              <span className="student-portal__item-meta">{accompaniment.objective}</span>
            </Link>
          </li>
        ))}
      </ul>
      {accompaniments.isDone ? null : (
        <p className="student-portal__hint">Mostrando los más recientes.</p>
      )}
    </>
  );
}
