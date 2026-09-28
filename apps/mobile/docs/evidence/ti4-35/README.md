# Evidencia TI4-35

La prueba se realizó el 27 de septiembre de 2026 en un Samsung SM-S911B conectado por USB, con el build de desarrollo de Android y datos ficticios del adaptador Mobile. Para compilar se usó `JAVA_HOME=/usr/lib/jvm/java-17-openjdk bun run mobile:android`, porque el JDK 26 predeterminado falló en la transformación `JdkImageTransform` del SDK Android.

## Recorrido

1. Entrar como Estudiante, abrir «Mis solicitudes» y seleccionar `SOL-DEMO-001`, aceptada.
2. Desplazarse hasta «Acompañamiento resultante» y pulsar «Ver acompañamiento». [Solicitud aceptada](solicitud-aceptada.png).
3. Comprobar la referencia del acompañamiento, la solicitud de origen, el estado y la fecha de apertura. [Acompañamiento resultante](acompanamiento-resultante.png).
4. Pulsar «Volver a la solicitud» y comprobar que vuelve al detalle con el enlace disponible.
5. Abrir `SOL-DEMO-002`, que está en revisión, y comprobar que no ofrece acceso a un acompañamiento. [Solicitud en revisión](solicitud-en-revision.png).
6. Con la base actualizada, abrir `SOL-DEMO-005` y comprobar que muestra `example-accompaniment-2` en estado «Pausado», sin mostrar el acompañamiento de `SOL-DEMO-001`. [Segundo acompañamiento](segundo-acompanamiento.png).

La ruta directa con una solicitud desconocida y los estados de carga, ausencia de datos y error se comprobaron con las pruebas automatizadas de Mobile.
