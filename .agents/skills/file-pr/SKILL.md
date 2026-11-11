---
name: file-pr
description: Prepara y crea o actualiza una pull request solicitada, con revisión obligatoria del código propio antes de publicar.
---

# Publicar una pull request

Esta skill prepara un cambio revisable; no incluye fusionar ni cerrar la PR. Lee [las reglas de ramas y PR](../../../docs/agents/pull-requests.md) y las instrucciones del área. Conserva los cambios ajenos.

## Preparar

1. Comprueba rama, estado, base, PR existente y diff desde el merge-base. Consulta la issue y sus dependencias; incorpora las decisiones posteriores que la persona haya indicado. Si existe una PR abierta de la rama, actualiza esa PR; no reabras una cerrada o fusionada por inferencia.
2. Revisa que el diff contenga el resultado solicitado, sin secretos ni cambios ajenos. Separa los cambios independientes cuando corresponda. Prepara los commits locales del trabajo autorizado y revisa el diff final; un commit no autoriza publicar por sí solo.
3. Ejecuta [code-review del proyecto](../code-review/SKILL.md) sobre el código que se va a publicar, incluidos los commits de la rama. Si hay defectos, incumplimientos de arquitectura o legibilidad, o falta evidencia necesaria, corrige lo autorizado y repite la revisión de lo afectado. No hagas push ni crees o actualices la PR hasta obtener un resultado aprobado para el código y la base actuales.
4. Aplica `verify-ceretime` y los checks pertinentes al diff. Reutiliza resultados solo si corresponden al mismo código y entorno. Si faltan otras comprobaciones, trabajo o evidencia, deja la PR en Draft y explica lo pendiente; Draft no sustituye la revisión de código obligatoria.

## Describir y publicar

El título y el enlace a la issue siguen la convención del proyecto. Abre el cuerpo con el problema y el comportamiento resultante; incluye pruebas ejecutadas, resultados, riesgos y pendientes que ayuden a revisar. Para cambios visuales adjunta evidencia de la interfaz real en escritorio y móvil cuando corresponda; no publiques datos sensibles. Si no puedes producirla, deja Draft y explica qué falta. No incluyas firmas ni atribuciones del agente.

Crea o actualiza la PR solo ante una solicitud explícita y con la base y estado que correspondan. Si el entorno ofrece integración de PR con la sesión, vincula la PR. Comprueba URL, base, rama, estado y commit publicado. Entrega los checks y revisiones pendientes; atenderlos o vigilar la PR requiere una solicitud adicional.
