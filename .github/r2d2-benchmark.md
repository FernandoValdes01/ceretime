# Benchmark reproducible de optimizaciones R2D2

Referencia antes: `08686f501739d7bca6454a0140ca4fee34afa820`.
Referencia después: árbol de trabajo en `/home/corvo/Documentos/github/ceretime-ti4-50`; SHA-256 del diff de implementación: `e5d6f4ad4d7293ecfc599d23e246abfc6f57cbbe45fb10b7a21fe42e83bd9db5`.
Fixture: base `f288fcfe05511208705a517efd451ffc09094e4f`, primera revisión `a0093ad958f634272e606854f625aa7500fb9603`, actualización `a8e5747de1d494fd2de201d6ac320d251dec0f74`. Commits sintéticos con fechas fijas.

## Comando

```sh
bun .github/ai-review-benchmark.cjs --write
```

El script extrae el baseline con `git archive`, crea el mismo repositorio sintético para ambos runtimes y recorre `enrichFiles`, `buildPlan`, `packReviewParts`, `reviewPlan`, recuperación Git real, caché firmada y el verificador independiente. Todas las respuestas de inferencia son mocks deterministas con asserts sobre rutas, coordenadas, candidatos y evidencia. No contacta al proveedor ni a GitHub.

## Datos del fixture

Incluye doce consumidores de un contrato compartido; imports ES con alias, namespace, `require` y efecto lateral; renombre puro y renombre modificado; un símbolo de helper omitido a propósito y recuperado desde Git; dos seguimientos incompatibles del mismo archivo; un candidato confirmado y otro refutado; y un archivo independiente que se cambia entre la repetición y la actualización.

- `apps/web/src/alias.ts`
- `apps/web/src/contracts/status.ts`
- `apps/web/src/defect.test.ts`
- `apps/web/src/defect.ts`
- `apps/web/src/effect-user.ts`
- `apps/web/src/followup.ts`
- `apps/web/src/helper.ts`
- `apps/web/src/independent.ts`
- `apps/web/src/legacy-name.ts`
- `apps/web/src/missing.ts`
- `apps/web/src/namespace.ts`
- `apps/web/src/one.ts`
- `apps/web/src/pure-new.ts`
- `apps/web/src/pure-old.ts`
- `apps/web/src/register.ts`
- `apps/web/src/renamed.ts`
- `apps/web/src/required.ts`
- `apps/web/src/shared-00.ts`
- `apps/web/src/shared-01.ts`
- `apps/web/src/shared-02.ts`
- `apps/web/src/shared-03.ts`
- `apps/web/src/shared-04.ts`
- `apps/web/src/shared-05.ts`
- `apps/web/src/shared-06.ts`
- `apps/web/src/shared-07.ts`
- `apps/web/src/shared-08.ts`
- `apps/web/src/shared-09.ts`
- `apps/web/src/shared-10.ts`
- `apps/web/src/shared-11.ts`
- `apps/web/src/two.ts`

## Resultados

| Fase                        | Llamadas antes / después | Análisis antes / después (caracteres) | Recuperación antes / después (caracteres) | Verificación antes / después (caracteres) | Reintentos antes / después (subconjunto de etapas) | Total transmitido antes / después (caracteres) | Reutilizados antes / después | Cobertura antes / después |
| --------------------------- | -----------------------: | ------------------------------------: | ----------------------------------------: | ----------------------------------------: | -------------------------------------------------: | ---------------------------------------------: | ---------------------------: | ------------------------- |
| Primera revisión            |                    8 / 6 |                     138,938 / 143,736 |                           31,758 / 38,678 |                            27,833 / 7,944 |                                    59,849 / 73,757 |                     198,529 / 190,358 (-8,171) |                  0/28 / 0/28 | complete / complete       |
| Repetición sin cambios      |                    3 / 0 |                            53,949 / 0 |                                     0 / 0 |                                23,218 / 0 |                                         27,115 / 0 |                           77,167 / 0 (-77,167) |                19/28 / 28/28 | complete / complete       |
| Actualización de un archivo |                    1 / 1 |                         8,354 / 8,784 |                                     0 / 0 |                                     0 / 0 |                                              0 / 0 |                           8,354 / 8,784 (+430) |                27/28 / 27/28 | complete / complete       |

Total de caracteres de solicitudes en las tres fases: 284,050 antes y 199,142 después; ahorro 29.9%. Las etapas incluyen instrucciones, formato JSON y mensajes completos; la columna de reintentos es un subconjunto informativo y no se suma dos veces. La recuperación local obtuvo 37 caracteres antes y 37 después; esos bytes también aparecen en la solicitud de análisis posterior y no se duplican en el total transmitido.
Etapas con mayor consumo después: en la primera revisión, análisis +4,798 caracteres y recuperación +6,920; el verificador baja −19,889. La actualización de un archivo suma +430 caracteres. La inferencia es que los IDs y referencias explícitas aumentan las solicitudes de análisis/recuperación, mientras la selección por candidato reduce la evidencia del verificador.
Tokens estimados: 71,013 antes y 49,786 después, usando 4 caracteres por token como aproximación gruesa. Tokens facturados: 0 en ambos runtimes; el benchmark no hizo llamadas reales.
Cobertura de coordenadas: 51/51 antes y 51/51 después; cada coordenada del diff aparece una vez. Ambos runtimes devolvieron `calculate-zero` y refutaron `normalize-case`.
Ahorro total: 29.9%. Meta orientativa de 15%: alcanzada.

## Reutilización y comprobaciones

Repetición sin cambios: 19/28 partes reutilizadas antes con 3 llamadas; después 28/28 partes y 0 llamadas. Actualización: 27/28 partes reutilizadas antes y 27/28 después; el archivo cambiado se vuelve a analizar.
Las seis revisiones terminaron con cobertura completa. El mock exige la recuperación de `apps/web/src/helper.ts`, presencia del hunk del defecto, envío a verificación, decisión confirmada/refutada, resolución de ambos seguimientos y presupuesto de entrada válido en todas las solicitudes.

## Identidad del código medido

- `.github/ai-review-benchmark.cjs`: `eeb014175a26290d43b8ffcc2db798b56db1e34210a1e29e61208dbb068a2b9a`
- `.github/ai-review-chunks.cjs`: `a322d015d3dfd35d63efc776288e397670facd00ddd7b3d24f3f472c2a22c73a`
- `.github/ai-review-confidence.cjs`: `411fff525b34af3473024b8c5078bafe53b838b3e0adddcda0a9e41e0fa3576a`
- `.github/ai-review-context.cjs`: `ee34124d7c53bb5b3dea20f41effb515de632446e10b7b9c8631e8efb694724b`
- `.github/ai-review-evidence.cjs`: `6086e9282758151e4784e97cd798167a8f6b2468092875f7c4295d875cc4acbc`
- `.github/ai-review-memory.cjs`: `686a5c4b695dbc62e98b3e5a864b68c7c3a09399a7d5a32376311118149ffa64`
- `.github/ai-review-payload.cjs`: `304ade1ac313517a298dde5d5a2f386fc8a59549d1a3c55ecf50ed52688f5a3a`
- `.github/ai-review-presentation.cjs`: `07cd3d2057c6bf9589208b2d2ae3b6db6be16798474507aea7fa774f4a3fa5af`
- `.github/ai-review-provider.cjs`: `c02007556430dd339e925d2624d6675213e60e8fac9179267bbede2475b93355`
- `.github/ai-review-selection.cjs`: `11c7beff2aee7f0f4a2e9b71734a3109abfe8e12d53b670220b78f28b6e7d3fe`
- `.github/ai-review-score.cjs`: `9853d0f9f9488dde647fa8bcc3a339425a4e8599df3b79a7e37e98c215979735`
- `.github/ai-review-verification.cjs`: `5a1646ca7afdfeb2b873ae9f414ec5314d5c9ca343bcec9f79424d24243affb3`
- `.pr-reviewer.yml`: `42e51728f9c8ba29cc990ba371b505c607c338b00d95202190439fea743f3b4f`

Los valores describen bytes de texto JavaScript transmitidos por request, no el tokenizer de un proveedor. Los campos de usage están fijados a cero y no representan una factura real. El ahorro puede variar con la longitud de contexto, el empaquetado y el tokenizer del proveedor.
