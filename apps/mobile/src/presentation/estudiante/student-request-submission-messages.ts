// Mensajes del envío de una solicitud. Los usan el anuncio del formulario y la lectura en voz alta,
// así que deben decir lo mismo en ambos. Con el simulador local dicen que es ficticio; con el servidor, no.
export function studentRequestSubmissionMessages(simulated: boolean) {
  return simulated
    ? ({
        submitting: "Enviando solicitud ficticia.",
        error: "No pudimos enviar la solicitud ficticia. Puedes reintentar.",
        success: "Solicitud ficticia enviada.",
      } as const)
    : ({
        submitting: "Enviando solicitud.",
        error: "No pudimos enviar la solicitud. Puedes reintentar.",
        success: "Solicitud enviada.",
      } as const);
}
