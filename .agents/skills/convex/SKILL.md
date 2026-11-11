---
name: convex
description: "Guía el trabajo con Convex en CERETIME: código, diseño, revisión, verificación y operaciones; selecciona solo las referencias necesarias."
---

# Convex en CERETIME

Este archivo es el punto de entrada compartido. Las guías están en `.agents/convex-guides/` y se leen como archivos, no como skills instaladas ni como agentes delegados. Selecciona solo las que correspondan a la tarea; sigue las instrucciones del repositorio y los límites de TI2 y TI4. Ante una instrucción incompatible, prevalecen las instrucciones de la persona y del proyecto.

## Selección

- Antes de escribir código en `convex/`: lee [convex-expert](../../convex-guides/convex-expert/SKILL.md), el schema y las reglas generadas del proyecto. Para API o librería cuya versión importe, consulta también [convex-docs](../../convex-guides/convex-docs/SKILL.md).
- Antes de un comando que pueda afectar un deployment, incluidos `convex dev`, `run`, seeds o cambios de variables: lee [convex-deploy-guard](../../convex-guides/convex-deploy-guard/SKILL.md). Confirma el destino y respeta los permisos del proyecto antes de operar.
- Para diseñar, explicar o revisar el backend: [convex-design](../../convex-guides/convex-design/SKILL.md), [convex-explain-app](../../convex-guides/convex-explain-app/SKILL.md) o [convex-reviewer](../../convex-guides/convex-reviewer/SKILL.md); para seguridad, [convex-authz](../../convex-guides/convex-authz/SKILL.md).
- Para pruebas y verificación: [convex-test](../../convex-guides/convex-test/SKILL.md), [convex-verify](../../convex-guides/convex-verify/SKILL.md) o [convex-seed](../../convex-guides/convex-seed/SKILL.md), según corresponda. `verify-ceretime` cubre los recorridos del producto.
- Para añadir una capacidad, consulta [convex-add](../../convex-guides/convex-add/SKILL.md) y después la guía específica en `.agents/convex-guides/`, si existe. Para crear un componente propio, lee [convex-create-component](../../convex-guides/convex-create-component/SKILL.md).
- Para iniciar un proyecto Convex desde cero, consulta [convex-quickstart](../../convex-guides/convex-quickstart/SKILL.md); no ejecutes un scaffold en una aplicación existente.
- Para operaciones de un deployment existente, elige la guía por nombre en `.agents/convex-guides/`: migración, respaldos, dominio, variables, diagnóstico, costos o monitoreo. Lee siempre primero `convex-deploy-guard` si la acción puede afectar el deployment.

Las guías conservan sus recursos y rutas relativas. Si una menciona otra capacidad por nombre, localiza su archivo en `.agents/convex-guides/<nombre>/SKILL.md` y lee solo lo necesario. Una guía no autoriza desplegar, compartir datos, cambiar producción ni instalar una dependencia por sí sola. No envíes transcripciones ni datos a terceros sin solicitud explícita.

Algunas guías de origen mencionan herramientas o rutas que no forman parte de este repositorio. En particular, `content/convex-expert.md` corresponde aquí a `convex-expert/SKILL.md`; aplica las políticas y contratos existentes de CERETIME antes de adoptar un helper genérico. Si falta una herramienta, informa el límite y usa las capacidades disponibles, sin suponer que existe una instalación global.
