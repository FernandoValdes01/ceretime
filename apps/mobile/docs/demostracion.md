# Demostración móvil

<!-- cspell:words vrhome -->

El recorrido usa datos ficticios compartidos entre roles dentro del mismo proceso de la aplicación. No necesita el backend de TI2. El acceso, el envío, la revisión y la aceptación están simulados; las preferencias y la voz conservan sus adaptadores nativos. No demuestra integración remota ni sincronización entre dispositivos.

## Preparación

En `vrhome`, usar el cliente Android y Metro del proyecto según el README móvil. Dejar las variables de simulación en su modo de éxito. Cerrar sesión y pulsar **Reiniciar demostración** antes de cada ensayo. El reinicio conserva las preferencias de accesibilidad y descarta solicitudes, acompañamientos y habilitaciones de cuentas de la demostración anterior. Una recarga completa también pierde esos datos.

## Recorrido central

1. Entrar como Estudiante y abrir **Nueva solicitud**. Describir una dificultad para leer materiales, pedir como resultado aprender a usar un lector de pantalla y completar los campos obligatorios. Confirmar el envío y mostrar el comprobante. En un escenario recién reiniciado, la referencia es `SOL-DEMO-006`.
2. Cerrar sesión y entrar como Profesional. En **Solicitudes**, abrir la solicitud nueva de Valentina Rojas. Mostrar el contenido ingresado y pulsar **Poner en revisión**.
3. Escribir el objetivo del acompañamiento y pulsar **Aceptar solicitud**. Mostrar la confirmación y el acompañamiento abierto. Visitar **Acompañamientos** para comprobar que aparece también en el listado.
4. Cerrar sesión y volver como Estudiante. En **Mis solicitudes**, abrir la solicitud recién enviada. Debe figurar **Aceptada**. Pulsar **Ver acompañamiento** y mostrar su referencia, solicitud de origen, estado, objetivo y necesidades de acceso. Es el mismo acompañamiento que abrió el Profesional.
5. Cerrar sesión y pulsar **Reiniciar demostración**. Volver al listado estudiantil para comprobar que la solicitud creada ya no aparece. El escenario inicial vuelve a estar disponible para otro ensayo.

El pedido profesional de información cambia el estado local, pero este guion no incluye una respuesta estudiantil posterior. Tampoco incluye reservas, asignaciones nuevas a Practicantes ni notificaciones reales.

## Recorrido complementario

Entrar como Profesional y abrir **Ver agenda**. La agenda identifica su día como **Día de demostración**, con fecha fija del 5 de noviembre de 2026. Avanzar muestra el viernes 6 con una actividad y el sábado 7 sin actividades; retroceder recupera el día anterior. Las fechas son ficticias y no representan la agenda actual.

## Validación antes de presentar

La prueba `__tests__/demo-scenario.test.tsx` ejecuta el recorrido entre pantallas y comprueba el vínculo entre roles, la aceptación única, el reinicio con escrituras pendientes y los cambios de mes. Las pruebas automatizadas no sustituyen el ensayo Android.

En Android falta repetir el recorrido central, comprobar el botón **Ver agenda**, ampliar texto al 150 % y 200 % y verificar que la navegación conserva palabras completas y que **Comandos de voz** no tapa acciones. Revisar también foco con TalkBack y la alternativa táctil a la voz. La entrega visual está pendiente hasta liberar el emulador, actualmente ocupado por otra sesión de dispositivos.
