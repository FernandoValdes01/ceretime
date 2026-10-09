# Persistencia nativa de TI4-50

Validación del 5 de octubre de 2026, entre las 21:40:27 y las 21:43:49 UTC, con autorización del usuario para ejecutar `ceretime-mobile`. Código probado: `7f02788666546586f8328b79700edce7398e08d3`, sobre `main` `975e05648715eb17f56994d06e19b0a91dd392ad`. Las capturas y los árboles XML provienen del emulador Android; contienen únicamente ajustes y datos de prueba.

## Entorno y cliente

| Dato                            | Valor                                                              |
| ------------------------------- | ------------------------------------------------------------------ |
| Emulador                        | `Medium_Phone`, `emulator-5554`, GPU `host`                        |
| Modelo y arquitectura           | `sdk_gphone16k_x86_64`, `x86_64`                                   |
| Android                         | 17, API 37, compilación `15923651`                                 |
| Pantalla                        | 1080 × 2400, 420 dpi, `font_scale=1.15`                            |
| Cliente                         | Expo SDK 57, React Native 0.86.3, AsyncStorage 2.2.0               |
| Paquete de prueba               | `cl.rmv.ceretime.ti450`, versión 1.0.0, código 1                   |
| Java de compilación             | Temurin JDK 17.0.20.1                                              |
| SHA-256 del APK de prueba       | `21d49015691764e417716922e63c387cf234104b441d162709bb39aa5b44ee53` |
| SHA-256 del consumidor temporal | `1c939cd54393a8c649908b2a45f7aed46ae33d01485cfae695d43a75b50bfec5` |

El cliente usa un sufijo de paquete `.ti450` en el build debug para conservar la instalación existente de CERETIME. Comparte el código de la aplicación y monta el proveedor real de `app/_layout.tsx`. El [parche de prueba](native-probe.patch) añade un consumidor debajo de ese proveedor. No crea otro puerto, adaptador ni proveedor. Los botones de guardado llaman a `updatePreferences`; el acceso directo a AsyncStorage solo permite inspeccionar la clave y sembrar o quitar datos de prueba. El parche queda inactivo en documentación y la ruta temporal se retira antes de publicar la PR.

## Pasos y resultados

| Paso                                                   | Resultado observado                                                                                                              | Evidencia                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Abrir con la clave ausente y consultar almacenamiento  | `ready`, origen `default`, los tres valores `system`, clave ausente                                                              | [Captura](01-defaults.png), [XML](01-defaults.xml)                       |
| Guardar texto `2`, contraste `on` y movimiento `on`    | Guardado confirmado; JSON con versión 1 y exclusivamente los tres campos                                                         | [Captura](02-guardado.png), [XML](02-guardado.xml)                       |
| Detener por completo el proceso y abrirlo con el atajo | PID `9199` → `10034`; origen `stored`, valores `2/on/on` recuperados del dispositivo                                             | [Captura](03-reinicio.png), [XML](03-reinicio.xml)                       |
| Sembrar `fixture-corrupto` en la misma clave           | El dispositivo contiene la cadena corrupta; la caché conserva el último valor confirmado hasta reiniciar                         | [Captura](04-corrupto.png), [XML](04-corrupto.xml)                       |
| Repetir el reinicio completo                           | Nuevo PID `10917`; origen `recovered`, defaults `system/system/system`, la lectura conserva la cadena corrupta en el dispositivo | [Captura](05-recuperado.png), [XML](05-recuperado.xml)                   |
| Guardar valores válidos después de la recuperación     | Guardado confirmado, origen `stored`, JSON válido `2/on/on`                                                                      | [Captura](06-guardado-recuperado.png), [XML](06-guardado-recuperado.xml) |

Los cambios de PID se comprobaron con `adb shell pidof cl.rmv.ceretime.ti450`. `ceretime-mobile` ejecuta `am force-stop` antes de abrir el cliente. El procedimiento conservó los datos del dispositivo. Al terminar se guardaron los tres valores `system`, se retiró la ruta temporal y se comprobó de nuevo la [pantalla de acceso normal](07-acceso-sin-ruta-de-prueba.png), con su [árbol XML](07-acceso-sin-ruta-de-prueba.xml).

Los errores de lectura/escritura, el reintento, la alerta visible sin excepción privada, las escrituras en cola, los consumidores simultáneos y la conservación al entrar/salir de los cuatro roles se verifican en la suite Jest del adaptador y proveedor reales. Esta ejecución nativa demuestra persistencia y recuperación; la aplicación de estilos y la política del sistema pertenecen a TI4-51. No acredita una auditoría general WCAG ni anuncios de TalkBack.

## Reproducción

Desde una rama de prueba con el cambio de TI4-50, aplicar el parche con `git apply apps/mobile/docs/evidence/ti4-50/native-probe.patch`. Instalar dependencias, ejecutar prebuild Android y añadir `applicationIdSuffix ".ti450"` únicamente al bloque `debug` del `android/app/build.gradle` generado. Compilar e instalar el APK con JDK 17 y el SDK Android local. Los archivos nativos generados y el APK no se versionan.

```sh
CERETIME_REPO=/ruta/al/worktree \
CERETIME_PACKAGE=cl.rmv.ceretime.ti450 \
CERETIME_ACTIVITY=cl.rmv.ceretime.ti450/cl.rmv.ceretime.MainActivity \
JAVA_HOME=/ruta/al/jdk17 ceretime-mobile
```

El atajo local admite esas variables para seleccionar el worktree y el cliente aislado. Esperar a que aparezca la pantalla de acceso y después abrir el consumidor; enviar el enlace antes de que termine de cargar el cliente puede dejar la pantalla de acceso como ruta inicial.

```sh
adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
  -d 'ceretime://ti4-50-native-probe' \
  -n cl.rmv.ceretime.ti450/cl.rmv.ceretime.MainActivity
```

Ejecutar la secuencia de la tabla, consultar almacenamiento después de cada apertura y volver a usar el atajo para cada reinicio. Para repetir el escenario ausente, quitar la clave desde el consumidor y reiniciar. Capturar la pantalla con `adb exec-out screencap -p` y su árbol con `adb shell uiautomator dump`. Al terminar, guardar defaults y retirar `app/ti4-50-native-probe.tsx` y el sufijo debug de la copia local.
