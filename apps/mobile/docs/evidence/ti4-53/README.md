<!-- cspell:words juanfra gradlew FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES -->

# Correcciones de controles de solicitud, TI4-53

La solicitud utiliza las tecnologías de asistencia del sistema. CERETIME no activa TalkBack ni modifica su voz, velocidad o verbosidad. Se descarta incorporar voz propia en este cambio por decisión del usuario. Los anuncios existentes se mantienen mediante React Native; no requieren un motor de voz adicional.

## Cambios

Los campos y opciones con errores incluyen el mensaje en su nombre accesible, conservando primero la etiqueta visible. Esto permite volver al control y conocer el error sin depender de que la persona tenga habilitada la lectura de pistas. Al corregir el valor, desaparece el error del nombre. Las pistas de los campos conservan las instrucciones de entrada.

Cuando Necesidades de acceso es el primer grupo inválido, el formulario solicita al contenedor mostrarlo y dirige el foco a Comunicación escrita. Se conservan los callbacks de teclado y desplazamiento, los roles de selección, los estados marcado e inhabilitado y los objetivos táctiles existentes de al menos 52 unidades lógicas de alto. No se altera la validación ni el contrato de envío.

Issue: [TI4-53](https://linear.app/ceretime/issue/TI4-53/corregir-etiquetas-errores-asociados-y-tamano-tactil-en-componentes-de).

## Verificación y pendientes

Las pruebas del formulario comprueban el nombre con error, su retirada tras corregir el campo, la solicitud de mostrar el grupo de apoyos y su selección. Las pruebas existentes cubren conservación de valores, fallo y reintento, y bloqueo del doble envío.

La evidencia de [TI4-47](https://github.com/FernandoValdes01/ceretime/pull/77) corresponde al código anterior. Las pruebas nativas de este cambio se describen abajo. Queda pendiente probar otras preferencias de TalkBack, incluidos pistas desactivadas y formato activado, y el recorrido manual completo con gestos. El estado inhabilitado se comprobó en la repetición descrita al final. TI4-54 conserva la corrección del contenedor y TI4-59 la revisión de anuncios de operación. No se afirma el cierre completo de TI4-53.

Validación automatizada: las tres suites de solicitud, modo de demostración y listado de solicitudes aprobaron 34 pruebas. También aprobaron `bun run --cwd apps/mobile typecheck`, `bun run lint`, `bun run format:check` y cspell sobre los cuatro archivos del cambio. La revisión del impacto confirmó que los consumidores del formulario conservan sus callbacks y que el ayudante compartido de pruebas sigue funcionando con nombres que incluyen errores. La ampliación posterior a estilos y fuentes sumó 42 pruebas: inicialmente falló una prueba que buscaba el nombre exacto anterior del campo; al actualizar ese selector, las seis pruebas de estilos aprobaron. Sus aserciones de color y foco se conservaron.

## Prueba nativa del 3 de octubre de 2026

Samsung Galaxy S23, modelo `SM-S911B`, Android 16, conectado por USB y autorizado por ADB. TalkBack de Samsung `16.2.00.12`, vinculado con exploración táctil activa. Escalas del sistema 1.0 y 1.5. No están instalados el binario ni el dispositivo virtual del emulador gestionado; se usó el teléfono conforme a la skill `android-emulator-qa`.

Código base `caf8ed229717434a49a8ce0c31273ed7e600d2bc` más el diff local de TI4-53. SHA-256 de `request-form.tsx` servido por Metro: `436ab33cba073ba71bc00402fd27fd7ddd05d8713aaa90ce8a5e2f641c7357ac`. Dependencias efectivamente instaladas: Expo `57.0.22`, React Native `0.86.3` y Expo Router `57.0.21`. Estas versiones describen el entorno ejecutado, aunque los rangos declarados en el proyecto sean posteriores.

El usuario autorizó compilar, instalar e iniciar Metro. `bun run mobile:android` compiló con JDK 17 después del fallo de transformación del SDK con JDK 26, pero Android rechazó reemplazar el Preview por tener otra firma. Se compiló un cliente de desarrollo temporal ARM64, versión `1.0.0`, con el identificador `cl.rmv.ceretime.qa`, cambiando solo el archivo Gradle generado e ignorado. Comando nativo: `JAVA_HOME=/usr/lib/jvm/java-17-openjdk ANDROID_HOME=/home/juanfra/Android/Sdk CMAKE_BUILD_PARALLEL_LEVEL=2 ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=2 --console=plain --quiet`. El archivo Gradle original se restauró después de instalar. SHA-256 de la APK temporal: `db1e7db51f8abffad10a0178bf750faab3359e368938696419188f0eb45865f2`. El código JavaScript de esta APK se carga desde Metro; el hash de la APK por sí solo no acredita el diff de presentación.

Se inspeccionaron nodos y eventos con una instrumentación temporal y `UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES`. Cada acción se ejecutó una vez sobre el nodo localizado por su nombre. No se usó un volcado que suspendiera TalkBack. Las acciones de accesibilidad también permiten operar nodos fuera de la pantalla: esto verifica estados y lógica, pero no equivale a completar el recorrido manual con gestos. Los resultados de nombres, estados, foco y eventos se resumen en la tabla siguiente. No se adjuntan volcados JSON, por preferencia del usuario.

| Escenario                      | Resultado nativo                                                                                                                                                                                               | Confirmación auditiva                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Envío vacío                    | Una activación de Enviar solicitud y un evento de anuncio de validación; el campo de necesidad recibe foco con la etiqueta y el error en su nombre. [Captura](01-empty.png).                                   | El usuario confirmó que el aviso y el nombre del campo con su error se entienden.      |
| Volver al campo                | Tras enfocar su instrucción y volver al campo, Android registra foco de accesibilidad con la etiqueta y el error completos.                                                                                    | Se comprobó el evento; no se pidió una confirmación auditiva separada de este retorno. |
| Corregir campos                | Los nombres de necesidad y resultado dejan de incluir el error, y conservan el texto introducido.                                                                                                              | Complemento por nodos.                                                                 |
| Apoyos vacíos                  | Se muestra el grupo y el foco termina en Comunicación escrita con su error. [Captura](04-access-error.png).                                                                                                    | El usuario confirmó que escuchó el error y la opción.                                  |
| Selección y errores siguientes | Comunicación escrita, Presencial y Lunes exponen marcado; desaparecen sus errores al seleccionarlos. Los primeros errores de modalidad, días y canal reciben foco con el mensaje en el nombre.                 | El usuario confirmó que se entendieron los errores de modalidad, día y canal.          |
| Envío válido                   | Se emiten anuncios de envío y éxito; aparece la referencia ficticia `SOL-DEMO-006`. El foco acaba en la referencia, como en el flujo anterior. [Captura](13-confirmation.png).                                 | El usuario confirmó el aviso de éxito.                                                 |
| Texto ampliado al 150 %        | Se repite el error de apoyos; Comunicación escrita queda visible y enfocada. El texto de las opciones se adapta a varias líneas sin recorte en la muestra inspeccionada. [Captura](15-large-access-error.png). | Comprobación visual y por nodos; no aprobación auditiva separada.                      |
| Fallo y reintento              | Con `EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE=fail-once`, el fallo conserva tres textos y tres selecciones. Reintentar envío produce comprobante.                                                                 | El usuario confirmó que entendió tanto el aviso de fallo como el éxito del reintento.  |

Las comprobaciones sobre los extractos aprobaron diez aserciones de foco, nombres, selección y comprobante, más la conservación de tres textos y tres selecciones tras el fallo, el éxito del reintento y el foco con escala 1.5. Las capturas fueron inspeccionadas y no contienen notificaciones personales.

Límite observado: al simular el fallo sin enfocar antes los campos, la pantalla permanece en la parte superior y el foco termina en el control de herramientas del cliente de desarrollo; Reintentar envío queda fuera de la vista. La instrumentación pudo activarlo desde su nodo. No se acredita su descubrimiento con gestos ni se atribuye el foco en herramientas al Preview de producción. Esta observación corresponde a la revisión posterior de anuncios y orientación del flujo, sin alterar esos bloques en TI4-53.

Al finalizar se restauró la escala 1.0 y TalkBack apagado, sin servicios de accesibilidad habilitados, como estaban al comenzar. No se modificaron preferencias de voz, formato ni pistas. Se retiraron la instrumentación y el cliente temporal, se eliminó el reenvío ADB de Metro y se detuvo el servidor. El Preview original permaneció instalado.

## Repetición tras recuperar la rama

Se recuperó TI4-53 sobre `main` `318e6c542502648c0f07adc5d09f485c480f338e`. El formulario conserva el mismo SHA-256 `436ab33cba073ba71bc00402fd27fd7ddd05d8713aaa90ce8a5e2f641c7357ac` que el código previamente probado por el usuario. La evidencia y los commits de TI4-47 no se incorporaron a esta rama.

En el mismo Samsung y cliente temporal se repitieron formulario vacío, foco al grupo de apoyos, selección de Comunicación escrita/En línea/Lunes, fallo y reintento. A los 350 ms del envío, los seis campos, seis apoyos, dos modalidades, siete días y botón de envío expusieron `enabled=false`: 22 controles. El reintento mostró `SOL-DEMO-006`. Son comprobaciones nativas automáticas; las confirmaciones auditivas de la tabla anterior corresponden a la sesión previa sobre el mismo formulario.

Con fuente del sistema `2.0`, Comunicación escrita recibió foco y su nombre incluyó el error del grupo. La [captura a 200 %](16-access-error-200.png) muestra opciones que se ajustan en varias líneas, sin recorte horizontal en esa muestra. No acredita todas las secciones o combinaciones con teclado a esa escala. Las opciones conservan `min-h-[52px]` y su ancho ocupa el grupo; campos y acciones existentes también superan el objetivo de 44 × 44 del diseño. No se redujeron esos tamaños.

Las transiciones internas existentes usan FadeIn/FadeOut con la configuración predeterminada. [Reanimated documenta que siguen ReduceMotion.System](https://docs.swmansion.com/react-native-reanimated/docs/guides/accessibility/). No se agregó otra preferencia ni se sustituyó la futura política de TI4-51; la reducción de movimiento no se validó visualmente en el teléfono.

Validación actual: `bun run --cwd apps/mobile typecheck` aprobado; las suites `student-request.test.tsx`, `student-request-demo-mode.test.tsx`, `student-styles.test.tsx` y `student-requests.test.tsx` aprobaron 40 pruebas. Se repitieron lint, formato y cspell. Se restauraron fuente 1.0 y TalkBack apagado, se retiraron los paquetes temporales y el reenvío ADB, y se detuvo Metro. El Preview original permanece instalado.

## Hallazgo visual de la cabecera al 200 %

El usuario señaló el círculo del perfil como elemento que se ve mal con texto ampliado. En la captura a 200 % se observa la inicial acercándose al borde inferior del círculo. `apps/mobile/src/presentation/components/app-header.tsx` define el avatar con ancho y alto fijos de 34 y radio 17; su inicial usa StudentText con tamaño 15 y conserva el escalado del sistema. El contenedor no aumenta con la letra. Para reproducir, entrar como Estudiante, ampliar la fuente del sistema a 200 % y observar el perfil de la cabecera.

Se espera que la inicial permanezca centrada y contenida, sin perder el nombre accesible del perfil. La corrección requiere adaptar el avatar al tamaño efectivo del texto o revisar su representación decorativa. Se entrega como coordinación propuesta a [TI4-51](https://linear.app/ceretime/issue/TI4-51/aplicar-texto-ampliado-y-reduccion-de-movimiento-desde), responsable de texto ampliado en componentes base. No se modifica la cabecera en TI4-53. Este hallazgo impide afirmar que toda la pantalla se ve correctamente al 200 %, aunque las opciones del formulario se ajusten en la muestra. Criterio de referencia: WCAG 1.4.4; no se afirma conformidad general.

## Cobertura completa del formulario al 200 %

Se recorrió el contenido completo con fuente del sistema `2.0`, TalkBack activo y el mismo hash de formulario. Ocho vistas cubren [inicio e instrucciones](17-inicio-200.png), [campos iniciales](18-campos-200.png), [resultado y primeros apoyos](19-resultado-apoyos-200.png), [resto de apoyos y alternativa](20-apoyos-alternativa-200.png), [modalidad](21-modalidad-200.png), [siete días](22-dias-200.png), [horas y canal](23-horas-canal-200.png) y [canal y envío](24-canal-envio-200.png). Los textos se ajustaron a varias líneas y las secciones pudieron revelarse mediante desplazamiento vertical; no se observó recorte horizontal en los controles internos. El octavo intento de desplazamiento devolvió fin de contenido, después del botón Enviar solicitud. Los cortes en los bordes del área desplazable no se interpretan como pérdida de contenido cuando el texto aparece en la vista contigua.

Se midieron los seis campos, seis apoyos, dos modalidades, siete días y botón de envío usando sus límites nativos en las vistas donde quedaron completamente visibles. Android informó densidad efectiva 420, equivalente a factor 2.625. Tras convertir los límites físicos a unidades lógicas, el menor lado observado entre esos 22 controles fue 56.76; todos superaron 44 × 44. La cabecera y las pestañas se excluyen de esta medición porque son controles externos al alcance de TI4-53.

La comprobación anterior es visual y nativa mediante acciones automáticas. La confirmación manual del recorrido completo con gestos se solicita sobre el formulario vacío al 200 %, sin ejecutar acciones automáticas mientras la persona lo recorre. El avatar permanece como hallazgo de la cabecera para TI4-51; no se afirma que toda la pantalla esté libre de defectos.
