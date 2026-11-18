/**
 * Pasos de una solicitud de acompañamiento, contados al Estudiante (TI2-149).
 *
 * Una sola redacción para Inicio y para «Mis solicitudes»: si cambia el
 * proceso, se corrige aquí. Describe lo que hace CERETI, no reglas que la Web
 * decida.
 */
export const REQUEST_PROCESS_STEPS = [
  {
    title: "Envía tu solicitud",
    text: "Cuéntanos tu necesidad y las condiciones de acceso que requieres.",
  },
  {
    title: "CERETI la revisa",
    text: "Un profesional revisa tu solicitud y te contacta con los próximos pasos.",
  },
  {
    title: "Coordinan tu acompañamiento",
    text: "Agendan atenciones y registran el seguimiento de tu proceso.",
  },
] as const;
