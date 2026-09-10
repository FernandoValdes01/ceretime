---
created: 2026-08-21T10:48
updated: 2026-08-21T10:48
---

# Especificación del prototipo CERETI

## Propósito

El proyecto entregará un prototipo web y móvil, desplegado y funcional de extremo a extremo, para coordinar solicitudes, atenciones y seguimiento operativo de acompañamientos de CERETI. Usará cuentas y datos de prueba y no estará autorizado para operar con acompañamientos reales.

La agenda es una parte del producto. El problema central es mantener continuidad y trazabilidad desde que un estudiante solicita apoyo hasta que CERETI cierra el acompañamiento.

## Contexto académico

El proyecto integra INFO1171 e INFO1173:

- INFO1171 desarrolla la aplicación web, el backend, la base de datos y la API.
- INFO1173 desarrolla la aplicación móvil y coordina el trabajo entre equipos.
- La solución comparte backend y base de datos, se aloja en un hosting y se desarrolla en incrementos.
- Seguridad, accesibilidad, pruebas, trazabilidad y contratos de API forman parte del producto, no de una etapa posterior.

## Alcance funcional

El prototipo implementará:

- Inicio de sesión con cuentas Google institucionales.
- Roles provisionales de administrador, profesional y estudiante.
- Solicitudes de acompañamiento con necesidades de acceso.
- Ingreso de solicitudes por el estudiante o por personal de CERETI cuando se reciban mediante un canal autorizado.
- Registro de derivaciones realizadas por otras unidades, sujetas a aceptación del estudiante.
- Revisión de solicitudes y apertura de acompañamientos.
- Disponibilidad recurrente, excepciones y prevención de cruces de agenda.
- Atenciones presenciales y en línea.
- Catálogo de espacios con condiciones e instrucciones de acceso.
- Reserva, cambio, cancelación e inasistencia.
- Justificaciones de inasistencia con plazo de cinco días hábiles.
- Seguimiento operativo, acuerdos, tareas, próximos pasos y notas internas breves.
- Notificaciones dentro de la aplicación, correo institucional y notificaciones push.
- Integración mínima con Google Calendar y alternativa mediante archivos `.ics`.
- Aviso de privacidad y solicitudes de acceso, corrección, bloqueo, exportación o supresión de datos.
- Bitácora de auditoría.
- Reportes y exportaciones de estadísticas agregadas.
- Accesibilidad en los flujos web y móvil.

No se implementarán:

- La eliminación o anonimización automática basada en plazos institucionales.
- Integraciones con otros sistemas internos de la UCT.

## Fuera de alcance

- Datos reales de estudiantes durante desarrollo, pruebas o demostraciones.
- Fichas clínicas, diagnósticos, certificados y evaluaciones psicológicas completas.
- Solicitudes de emergencia o reproducción de protocolos de crisis.
- Mapas, geolocalización y navegación dentro del campus.
- Simulación de conversaciones, asistentes con IA y decisiones automatizadas.
- Consulta de becas y generación de materiales accesibles.
- Talleres, eventos y atenciones grupales.
- Modalidad híbrida.
- Lectura completa de calendarios Google.
- WhatsApp y SMS.
- Sanciones automáticas por inasistencia.

## Usuarios y acceso

Los roles del prototipo son provisionales:

| Rol           | Acceso mínimo del prototipo                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estudiante    | Sus solicitudes, acompañamientos, atenciones, acuerdos, tareas, necesidades de acceso y solicitudes de privacidad.                                |
| Profesional   | Solicitudes y acompañamientos que tenga asignados, agenda y registros de seguimiento correspondientes.                                            |
| Administrador | Cuentas, configuración, espacios y reportes agregados. No recibe acceso irrestricto a notas internas por el solo hecho de administrar el sistema. |

Las cuentas `@alu.uct.cl` ingresan al portal estudiantil. Las cuentas `@uct.cl` sólo acceden al área de gestión cuando CERETI las ha habilitado. El dominio acredita pertenencia institucional, pero no concede acceso a un acompañamiento.

La matriz definitiva de permisos y su correspondencia con cargos reales quedan pendientes de validación con CERETI.

## Modelo del acompañamiento

Un estudiante no es un caso. Puede tener varios acompañamientos simultáneos o históricos, cada uno asociado a una necesidad u objetivo, responsables, atenciones y cierre propios.

```text
Solicitud o derivación aceptada
            |
            v
     Acompañamiento
       |     |     |
       |     |     +--> Necesidades de acceso
       |     +--------> Profesionales asignados
       +--------------> Atenciones --> Seguimiento
```

Un acompañamiento puede estar activo, pausado o cerrado. El cierre conserva el historial en modo de sólo lectura. Una necesidad posterior origina una solicitud y un acompañamiento nuevos.

## Solicitudes

La solicitud principal es no urgente y pide solamente:

- Nombre y correo obtenidos de la cuenta Google.
- Descripción libre de la barrera o necesidad.
- Resultado que el estudiante espera de CERETI.
- Necesidades de acceso.
- Preferencia presencial o en línea.
- Rangos generales de disponibilidad.
- Medio accesible preferido para recibir información.

No pide RUT, diagnóstico, área interna de CERETI, certificados ni archivos adjuntos.

Sus estados son:

1. Recibida.
2. En revisión.
3. Esperando información o aceptación del estudiante.
4. Aceptada, lo que abre un acompañamiento.
5. Derivada a otra unidad.
6. Cerrada sin acompañamiento, con una razón comprensible.
7. Cancelada por el estudiante.

Una derivación realizada por otra unidad no abre un acompañamiento. CERETI debe contactar al estudiante y obtener su aceptación.

## Necesidades de acceso

La solicitud permite seleccionar varias necesidades y agregar texto libre sin preguntar el diagnóstico. Puede registrar comunicación escrita, intérprete de lengua de señas, sala físicamente accesible, reducción de estímulos, más tiempo para comunicarse, participación de una persona de apoyo u otra condición.

Al aceptar la solicitud, estas necesidades pasan al acompañamiento. El estudiante puede actualizarlas y el cambio afecta las atenciones futuras sin alterar el historial. Si CERETI no dispone de una hora compatible, el sistema muestra canales oficiales accesibles y entrega un código de referencia. No ofrece una sala incompatible ni reduce una necesidad para encontrar cupo.

## Agenda y atenciones

Cada profesional define bloques recurrentes y excepciones. Los bloques indican duración, modalidad y lugar. El sistema evita cruces entre estudiantes, profesionales y salas.

El estudiante reserva directamente una hora disponible cuando ya posee un acompañamiento activo. Una atención con varios profesionales requiere coordinación por personal autorizado.

Las modalidades son:

- Presencial, con campus, edificio, piso, sala, condiciones de acceso e instrucciones compatibles con lector de pantalla.
- En línea, con un enlace privado y una plataforma que permita subtítulos o interpretación cuando corresponda.

Una atención puede quedar realizada, cancelada por el estudiante, cancelada por CERETI, reagendada o registrar una inasistencia. Reagendar conserva la fecha original. CERETI debe indicar un motivo al cancelar; para el estudiante es opcional. No hay sanciones automáticas.

Después de una inasistencia existe un plazo de cinco días hábiles. El estudiante entrega una explicación accesible. Si existe un certificado u otro respaldo sensible, se entrega por un canal institucional autorizado y el sistema sólo registra su recepción y revisión. Al vencer el plazo o rechazarse la explicación, la inasistencia queda sin justificar.

## Seguimiento

El sistema es un registro operativo, no una ficha clínica. Después de una atención conserva:

- Estado de la atención.
- Acuerdos y próximos pasos.
- Tareas y responsables.
- Fecha sugerida para la próxima atención.
- Una nota interna breve cuando sea necesaria.

El estudiante ve sus acuerdos y tareas. La nota interna se limita a profesionales autorizados en el uso cotidiano, sin perjuicio de una solicitud formal de acceso a datos y de las excepciones legales que la UCT determine.

## Comunicaciones y calendario

La aplicación mantiene un centro de notificaciones y envía correo institucional. Las notificaciones push son opcionales. Todo mensaje que pueda aparecer fuera de una sesión autenticada usa texto genérico, como “Tienes una atención programada”, y no revela CERETI, el profesional ni el tipo de acompañamiento. Ninguna información depende sólo del sonido.

La integración con Google Calendar ocurre por atención y mediante una acción explícita. El sistema no lee el calendario completo. Los eventos tienen títulos genéricos y también pueden descargarse como `.ics`.

## Reportes y exportaciones

CERETI puede consultar y exportar estadísticas operativas agregadas sobre solicitudes, tiempos de espera, atenciones, cancelaciones e inasistencias. Los reportes evitan grupos pequeños que permitan identificar indirectamente a una persona.

No se exportan masivamente notas internas, necesidades de acceso ni descripciones personales. Cada exportación queda registrada en la auditoría. El estudiante puede exportar sus propios datos desde el módulo de privacidad.

## Accesibilidad

La aplicación web deberá cumplir WCAG 2.2 niveles A y AA. La aplicación móvil aplicará los criterios A y AA pertinentes mediante la guía WCAG2Mobile.

Las verificaciones incluyen:

- Navegación completa por teclado y foco visible.
- Nombres, roles, estados y mensajes reconocibles por lectores de pantalla.
- Contraste, ampliación y reflujo del texto.
- Alternativas textuales y subtítulos.
- Controles táctiles de tamaño suficiente.
- Ausencia de tareas que exijan voz, audio, gestos complejos o percepción del color.
- Autenticación y formularios sin barreras cognitivas innecesarias.

Los desarrolladores ejecutan pruebas cruzadas, de modo que quien prueba una función no sea quien la implementó. Una persona de CERETI valida el flujo y el lenguaje. Esta evidencia permite hablar de verificación técnica, no de validación por personas con discapacidad.

Fuentes: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) y [orientación WCAG2Mobile](https://www.w3.org/TR/wcag2mobile-22/).

## Protección de datos personales

La Ley 21.719 entra en vigencia el 1 de diciembre de 2026. Las necesidades de acceso y los antecedentes de discapacidad o salud pueden constituir datos personales sensibles. El diseño debe asumir ese nivel de protección aunque el prototipo sólo utilice datos ficticios. [Ley 21.719](https://www.bcn.cl/leychile/Navegar/imprimir?idNorma=1209272) y [Ley 19.628 con vigencia diferida](https://www.bcn.cl/leychile/navegar?idNorma=141599&idVersion=2026-12-01).

Para el diseño se asume que la UCT es responsable de los datos y CERETI la unidad responsable del acompañamiento. Esta definición, la base jurídica aplicable a los datos sensibles y las responsabilidades de eventuales proveedores deben validarse institucionalmente antes de usar datos reales.

El prototipo incorpora:

- Minimización: no solicita diagnósticos, RUT, certificados ni documentos clínicos.
- Finalidad: usa los datos sólo para solicitar, coordinar y seguir acompañamientos.
- Aviso de privacidad accesible y permanentemente disponible.
- Acceso restringido por rol y por acompañamiento asignado.
- Notificaciones externas sin detalles sensibles.
- Auditoría de accesos, cambios, exportaciones y eliminaciones, sin copiar el contenido sensible en la bitácora.
- Solicitudes de acceso, corrección, bloqueo, exportación y supresión, con respuesta fundada.
- Política de conservación configurable, cuya duración definirá la UCT.
- Protección desde el diseño y medidas de seguridad acordes al riesgo.

La versión futura de la ley fija un plazo general de treinta días corridos para responder solicitudes de derechos, prorrogable una vez por otros treinta, y exige una evaluación de impacto cuando una operación pueda producir un alto riesgo. Antes del uso real, la UCT debe determinar formalmente si este sistema requiere dicha evaluación; realizarla de todos modos sería prudente por la naturaleza sensible de los datos. [Derechos del titular](https://www.bcn.cl/leychile/navegar?idNorma=141599&idParte=8642686&idVersion=2026-12-01) y [evaluación de impacto y seguridad](https://www.bcn.cl/leychile/Navegar/imprimir?idNorma=1209272).

La UCT también debe resolver antes de una puesta en marcha:

- La base jurídica para cada categoría de datos y el uso de consentimiento expreso cuando corresponda.
- El procedimiento aplicable a estudiantes menores de edad.
- La duración de conservación y las excepciones que suspenden la eliminación.
- La ubicación del hosting, transferencias internacionales y contratos con proveedores.
- La respuesta y notificación de incidentes de seguridad.
- Las instrucciones y reglamentos que emita la Agencia de Protección de Datos Personales.

En documentación funcional se usa “acompañamiento”. “Tratamiento de datos personales” se reserva para el sentido jurídico de la ley.

## Seguridad mínima

- OpenID Connect sobre OAuth 2.0 con Google Workspace institucional.
- Verificación del dominio y de los atributos firmados por Google; el parámetro de dominio por sí solo no autoriza el acceso.
- Habilitación previa de cuentas de funcionarios.
- Autorización en backend para cada recurso, además de ocultar opciones en la interfaz.
- Cifrado en tránsito y en reposo.
- Gestión de secretos fuera del repositorio.
- Sesiones y tokens almacenados mediante mecanismos seguros de cada plataforma.
- Respaldos cifrados y restauración probada.
- Dependencias revisadas y actualizadas.
- Bitácora protegida contra modificaciones desde las interfaces normales.
- Datos ficticios en desarrollo, pruebas, capturas, videos y demostraciones.

## Definición de terminado

El proyecto está terminado cuando:

- La aplicación web, la aplicación móvil, el backend, la base de datos y la API están integrados y desplegados.
- Los flujos de solicitud, apertura de acompañamiento, reserva, atención, seguimiento, justificación y cierre funcionan de extremo a extremo.
- Google institucional, correo, push, Calendar y `.ics` funcionan en el entorno de prueba.
- Las solicitudes de privacidad, auditoría y reportes agregados están implementados.
- Los tres roles provisionales respetan una matriz de acceso probada.
- Los flujos principales cuentan con pruebas automáticas y evidencia de verificación manual de accesibilidad.
- La persona de CERETI valida los escenarios funcionales y el lenguaje.
- No se han utilizado datos reales y el producto no se presenta como autorizado para operar en producción.

## Propuesta de incrementos

| Hito                | Resultado integrado                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Perfil, semana 4    | Prototipo de interfaz, modelo del dominio, arquitectura, contratos de API, amenazas y criterios de accesibilidad. |
| Sprint 1, semana 8  | Inicio de sesión, roles provisionales, solicitud, revisión y apertura de acompañamiento.                          |
| Sprint 2, semana 13 | Disponibilidad, espacios, reserva, modalidades, notificaciones, calendario e inasistencias.                       |
| Final, semana 17    | Seguimiento, privacidad, auditoría, reportes, pruebas, accesibilidad y despliegue completo.                       |

Seguridad, accesibilidad y pruebas se trabajan desde el primer incremento; la tabla indica cuándo queda completo cada flujo.

## Pendientes de validación

- Matriz definitiva de permisos y cargos reales de CERETI.
- Confirmación formal de la UCT como responsable de datos y de la base jurídica aplicable.
- Plazo institucional de conservación.
- Canales oficiales accesibles y tiempo esperado de revisión de solicitudes.
- Credenciales y configuración institucional de Google OAuth.
- Proveedores autorizados para hosting, correo y notificaciones push.
- Procedimiento para estudiantes menores de edad.
- Revisión jurídica, de ciberseguridad y autorización antes de usar datos reales.
- Confirmación del calendario del curso: la guía contiene referencias tanto a la semana 12 como a la semana 13 para el segundo incremento.

El análisis jurídico y su lista de comprobación se encuentran en [Aplicación de la Ley 21.719](./ley-21719.md).
