# Identidad de R2D2 en GitHub

El resumen y los comentarios inline usan el nombre R2D2. La imagen del reviewer está en `.github/assets/r2d2.jpg`; no pertenece a Web ni Mobile. El resumen muestra la nota real como `Confidence Score: N/5`, una tabla de riesgo, hallazgos y estado, el SHA enlazado y los datos de ejecución plegados. Elimina las negritas de la prosa y el pie publicitario del reviewer. También ordena los comentarios antiguos de esa identidad asociados a sus reviews de IA identificadas en la PR, conservando su SHA original. Los bloques de sugerencias y el código permanecen intactos.

## Autor y avatar

El autor de GitHub depende del token usado para publicar. `GITHUB_TOKEN` pertenece a la App de GitHub Actions y publica como `github-actions[bot]`; cambiar un título no cambia esa identidad. Para usar una identidad propia, [registra una GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) y autentica mediante su token de instalación.

1. Abre [Developer settings → New GitHub App](https://github.com/settings/apps/new). La App de esta integración se llama `R2D2-reviewer`, con slug `r2d2-reviewer`; su autor es `r2d2-reviewer[bot]`. Usa la URL del repositorio como Homepage URL. El nombre visible del resumen sigue siendo R2D2.
2. Desactiva Webhook y no solicites autorización de usuarios. El workflow de Actions ejecuta el reviewer; la App aporta su identidad.
3. Concede solo Repository permissions: Contents `Read-only`, Pull requests `Read and write` y Commit statuses `Read and write`. Metadata `Read-only` es implícito. No necesita permisos de administración, Issues, Checks ni escritura de Contents.
4. Registra la App privada y configura `.github/assets/r2d2.jpg` como logo en sus ajustes. Instala la App seleccionando únicamente `ceretime`.
5. Guarda el App ID como secret `R2D2_APP_ID`. Genera una private key y guarda su contenido exclusivamente en el secret `R2D2_APP_PRIVATE_KEY` de GitHub Actions. No guardes el archivo PEM en el repositorio ni envíes su valor al chat o a comentarios.
6. Ejecuta de nuevo `AI Code Review` en la PR de TI4-45. Comprueba el autor propio y el avatar en una review nueva, su SHA y su status. Las publicaciones históricas conservan su autor original.

La integración usa `actions/create-github-app-token`, fijada por SHA, para generar un token limitado al repositorio y a esos tres permisos. Entrega el mismo token a la Action y a los scripts de publicación. La Action de tokens lo revoca al terminar el job. El workflow no imprime credenciales y mantiene `persist-credentials: false` en el checkout.

Si faltan los secrets de la App, el reviewer sigue funcionando con `GITHUB_TOKEN`: el contenido muestra R2D2, pero el autor todavía es `github-actions[bot]`. No se presenta ese modo como una identidad propia comprobada. Si los secrets existen pero la autenticación falla, se publica un fallo de ejecución; no se considera una review válida.

## Prueba real de la App

El 02/10/2026 se comprobó la App instalada y sus secrets mediante el [intento 2 del run 36950538385](https://github.com/FernandoValdes01/ceretime/actions/runs/36950538385/attempts/2). Autenticación, llamada real a Groq, normalización, publicación y revocación del token terminaron correctamente. La [review 5393646415](https://github.com/FernandoValdes01/ceretime/pull/74#pullrequestreview-5393646415) tiene autor `r2d2-reviewer[bot]`, el avatar de R2D2 y `commit_id: 2d6e1025572cf7cc9dfae247b0ad6952cebb99d4`, coincidente con el head probado. Los statuses inicial y final de ese SHA también tienen a la App como creadora. No se leyeron ni imprimieron los valores de los secrets, no se añadieron permisos y no fue necesario corregir el código de autenticación.

El resultado del reviewer fue 0/5 por cobertura incompleta, con failure informativo: la autenticación propia funciona, pero esta prueba no convierte la evaluación parcial en 5/5. El avatar se comprobó visualmente desde la URL de la autora de la review y corresponde a `.github/assets/r2d2.jpg`. Las reviews anteriores de GitHub Actions conservan su autor; las nuevas publicaciones usan la App mientras sus secrets estén configurados.

## Score y transición desde Greptile

El diseño muestra `5/5` cuando una evaluación vigente, completa y sin hallazgos obtiene ese score. No transforma un `0/5` en `5/5` por presentación. El límite de 10.000 caracteres de la versión fijada sigue aplicando: una PR extensa puede recibir observaciones, pero su score es 0/5 por cobertura incompleta. La aprobación humana continúa siendo obligatoria.

El workflow remoto `Sincronizar check de Greptile` fue desactivado mediante la API de GitHub después de retirar sus archivos en esta rama. Su estado consultado es `disabled_manually`. Ya no debe publicar el status antiguo sobre commits nuevos. Los statuses históricos siguen asociados a sus commits; no se heredan al SHA nuevo. Esto no desinstala la GitHub App de Greptile: verifica su instalación y suscripción por separado. No se modificó el ruleset ni se integró directamente en main.
