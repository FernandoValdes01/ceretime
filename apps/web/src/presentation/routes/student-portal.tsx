import { Component, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import { AccessibilityMenu } from "../accessibility/AccessibilityMenu.tsx";
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
import "./student-portal.css";

/**
 * Estructura del portal del Estudiante (TI2-6).
 *
 * Solo navegación y protección: el encabezado enlaza el inicio del portal
 * y la sesión (donde vive el cierre). Las vistas funcionales de
 * solicitudes, agenda y seguimiento llegan en Sprint 2 y cuelgan de este
 * layout tras el mismo guard.
 */
export function StudentLayout() {
  return (
    <div className="student-portal">
      <a href="#student-content" className="student-portal__skip">
        Saltar al contenido principal
      </a>
      <header className="student-portal__header">
        <div className="student-portal__bar">
          <Link
            to="/estudiante"
            className="student-portal__brand"
            aria-label="CERETI, ir al inicio del portal"
          >
            <span className="student-portal__mark" aria-hidden="true">
              CE
            </span>
            <span className="student-portal__name">
              <strong>CERETI</strong>
              <span>Portal del Estudiante</span>
            </span>
          </Link>
          <div className="student-portal__actions">
            <nav aria-label="Portal del Estudiante">
              <Link to="/estudiante">Inicio</Link>
              <Link to="/estudiante/solicitudes">Solicitudes</Link>
              <Link to="/login">Sesión</Link>
            </nav>
            <AccessibilityMenu />
          </div>
        </div>
      </header>
      <div className="student-portal__main" id="student-content">
        <Outlet />
      </div>
    </div>
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
  { children: ReactNode; subject: string; level: "page" | "section"; onError?: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(): void {
    this.props.onError?.();
  }

  render() {
    if (this.state.hasError) {
      if (this.props.level === "section") {
        return (
          <div>
            <p role="alert" className="student-portal__error">
              No pudimos cargar {this.props.subject}. Si el problema persiste, tu cuenta podría
              estar pendiente de habilitación.
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
            No pudimos cargar {this.props.subject}. Si el problema persiste, tu cuenta podría estar
            pendiente de habilitación.
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
  const [requestsFailed, setRequestsFailed] = useState(false);
  const [accompanimentsFailed, setAccompanimentsFailed] = useState(false);
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

  // Sesión válida pero ambas queries de recursos denegadas: la cuenta no
  // está habilitada (el backend responde denegación genérica por diseño).
  // Es un estado permanente, no un error transitorio: sin reintento.
  const pendingEnablement = requestsFailed && accompanimentsFailed;

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
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            disabled
            title="Pronto podrás enviar tu solicitud desde aquí"
          >
            Solicitar acompañamiento
          </button>
          <a href="#como-funciona" className="student-portal__btn student-portal__btn--ghost">
            Cómo funciona
          </a>
        </div>
        <p className="student-portal__hint">Pronto podrás enviar tu solicitud desde aquí.</p>
      </section>

      <section
        aria-labelledby="como-funciona-title"
        id="como-funciona"
        className="student-portal__section"
      >
        <h2 id="como-funciona-title">Cómo funciona el acompañamiento</h2>
        <ol className="student-portal__steps">
          <li className="student-portal__step">
            <span className="student-portal__step-num" aria-hidden="true">
              1
            </span>
            <h3>Envía tu solicitud</h3>
            <p>Cuéntanos tu necesidad y las condiciones de acceso que requieres.</p>
          </li>
          <li className="student-portal__step">
            <span className="student-portal__step-num" aria-hidden="true">
              2
            </span>
            <h3>CERETI la revisa</h3>
            <p>Un profesional revisa tu solicitud y te contacta con los próximos pasos.</p>
          </li>
          <li className="student-portal__step">
            <span className="student-portal__step-num" aria-hidden="true">
              3
            </span>
            <h3>Coordinan tu acompañamiento</h3>
            <p>Agendan atenciones y registran el seguimiento de tu proceso.</p>
          </li>
        </ol>
      </section>

      {pendingEnablement ? (
        <section aria-labelledby="pending-enablement-title" className="student-portal__section">
          <div className="student-portal__section-head">
            <h2 id="pending-enablement-title">Cuenta pendiente de habilitación</h2>
          </div>
          <div className="student-portal__empty">
            <p className="student-portal__empty-title">
              Tu cuenta aún no está habilitada para ver tus recursos.
            </p>
            <p>
              Un integrante de CERETI debe habilitar tu cuenta de Estudiante. Revisa tu sesión o
              contáctanos por los canales oficiales.
            </p>
          </div>
        </section>
      ) : (
        <>
          <StudentRequestsSection onError={() => setRequestsFailed(true)} />

          <StudentAccompanimentsSection onError={() => setAccompanimentsFailed(true)} />
        </>
      )}

      <section aria-labelledby="student-attentions-title" className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id="student-attentions-title">Atenciones</h2>
          <span className="student-portal__soon">Próximamente</span>
        </div>
        <div className="student-portal__empty student-portal__empty--blue">
          <p className="student-portal__empty-title">Aún no tienes atenciones agendadas.</p>
          <p>Cuando tengas atenciones agendadas en un acompañamiento activo, aparecerán aquí.</p>
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
function StudentRequestsSection({ onError }: { onError: () => void }) {
  return (
    <section aria-labelledby="student-requests-title" className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id="student-requests-title">Solicitudes</h2>
      </div>
      <StudentPanelErrorBoundary subject="tus solicitudes" level="section" onError={onError}>
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
function StudentAccompanimentsSection({ onError }: { onError: () => void }) {
  return (
    <section aria-labelledby="student-accompaniments-title" className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id="student-accompaniments-title">Acompañamientos</h2>
      </div>
      <StudentPanelErrorBoundary subject="tus acompañamientos" level="section" onError={onError}>
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
            <span className="student-portal__chip">
              {accompanimentStatusLabel(accompaniment.status)}
            </span>
            <span className="student-portal__item-meta">{accompaniment.objective}</span>
          </li>
        ))}
      </ul>
      {accompaniments.isDone ? null : (
        <p className="student-portal__hint">Mostrando los más recientes.</p>
      )}
    </>
  );
}
