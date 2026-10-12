# Evidencia TI4-58

## Alcance

La pantalla común consume el proveedor de preferencias existente y ofrece una única ruta protegida para los cuatro roles.

## Verificación Android nativa

- Dispositivo: Samsung Galaxy S23 (`SM-S911B`), Android 16, API 36; TalkBack 16.2.00.12 con voz en español; escala del sistema en 100 %.
- Cliente `cl.rmv.ceretime.qa`, versión 1.0.0; binario nativo compilado desde `641c967173f5acc02032a51ec0e35ce48431891a`, SHA-256 `b2dbe2bb281224ab59970294867306be416795a05fa43409c80af5f593eb09da`; Metro sirvió el JavaScript del árbol integrado.
- Abrí Preferencias desde la cabecera compartida de Estudiante, Profesional, Practicante y Administrador; las cuatro rutas mostraron el mismo resumen y el mismo estado almacenado.
- Con TalkBack activo, las alternativas se expusieron como `RadioButton` con nombre de categoría/opción y estado marcado; el doble toque cambió la selección y actualizó el resumen visible.
- Probé texto al 100 %, 150 % y 200 %; contraste activado y desactivado; reducción de movimiento y movimiento permitido. «Seguir el sistema» restableció los tres ajustes y el resumen coincidió con el dispositivo.
- Guardé 150 %, cerré la app por completo y la volví a abrir: la selección se conservó. Después elegí 150 % en Administrador, cambié a Estudiante y comprobé la misma selección y resumen.
- La escritura fallida no se forzó desde la interfaz nativa; el caso de error y la conservación del valor guardado se cubren en las pruebas de preferencias del stack.
- No se grabó audio de TalkBack; se comprobó la navegación, activación, nombre y estado en el dispositivo. Esta evidencia no declara conformidad WCAG general.

## Restauración

Al terminar detuve Metro, restablecí las preferencias de la aplicación y los ajustes iniciales de TalkBack, exploración táctil y escala del sistema, y desinstalé solo el cliente `.qa`; `cl.rmv.ceretime` permaneció instalado.
