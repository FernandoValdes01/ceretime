---
name: prototype
description: Explora variantes interactivas de una pieza de interfaz para elegir una dirección.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: "false"
---

# Prototipos

Úsala cuando una persona pida explícitamente explorar variantes. Lee `ui`, `DESIGN.md`, las instrucciones del área y la pantalla existente; conserva la identidad del producto salvo que el encargo indique cambiarla.

1. Define la pieza, su contexto y las acciones que debe permitir. Propón tres direcciones distintas por defecto, identificadas por nombre y por el eje que cambia: composición, densidad, interacción o movimiento.
2. Construye cada variante como HTML autocontenido con datos ficticios realistas y controles funcionales. Mantén el trabajo de exploración separado del código productivo. Una variante de Mobile debe representar el espacio y la interacción del dispositivo; el HTML no demuestra comportamiento nativo.
3. Comprueba las interacciones, el espacio de escritorio y móvil que corresponda, el texto ampliado y la reducción de movimiento. Si no puedes usar las herramientas de vista previa, entrega los archivos disponibles y señala ese límite.
4. Presenta cada variante, sus ventajas y costos, y espera la elección. Entrega los archivos y la evidencia con el mecanismo disponible en el entorno, sin depender de servicios privados del equipo. No subas contenido sensible.
5. Tras la elección, implementa la dirección en la aplicación siguiendo sus convenciones y usa `verify-ceretime` para verificar el resultado real.
