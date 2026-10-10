# Evidencia Android nativa de TI4-51

Las capturas se tomaron en la app nativa del commit `1afa458`, en el emulador `Medium_Phone`, Android 17 (API 37), resolución 1080 × 2400. TalkBack permaneció activo y la pantalla muestra el Inicio de Estudiante con contenido ficticio.

Para la captura base se configuró `font_scale=1.15`, `high_text_contrast_enabled=0` y `transition_animation_scale=0`. Para texto ampliado se cambió `font_scale=1.5` y se mantuvieron las otras dos opciones. Para alto contraste se restauró `font_scale=1.15` y se activó `high_text_contrast_enabled=1`. TalkBack permaneció activo durante los tres escenarios.

![Pantalla Android base con TalkBack y escala del sistema 1.15](./ti4-51-android-base.png)

![La misma pantalla Android con texto del sistema ampliado a 1.5](./ti4-51-android-texto-150.png)

![Pantalla Android con alto contraste del sistema y TalkBack](./ti4-51-android-alto-contraste.png)

Al ampliar el texto, la descripción ocupa más líneas y las dos acciones, sus nombres y la navegación inferior siguen visibles. Con alto contraste, la acción principal cambia de `#00695B` a `#00473F` y su texto conserva una señal visible; el estado de las acciones también permanece expresado con texto. No se enviaron formularios.

La app se ejecutó con reducción de movimiento del sistema activa (`transition_animation_scale=0`). La prueba `accessibility-preferences-runtime.test.tsx` cambia el evento del sistema y comprueba el modo real de Reanimated en los valores JS y UI. Una imagen estática no demuestra la duración de cada animación por vista.
