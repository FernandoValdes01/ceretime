# Revisión vigente e integración en paralelo

Una revisión cubre una combinación exacta de commits, no solo una rama. Aplica esta referencia tanto en `self-review` como en `review-ti2-pr`, al iniciar cada pasada, antes de emitir el veredicto y justo antes de publicarlo.

## Fijar las referencias remotas

Consulta en GitHub el repositorio destino, la rama y el SHA de origen de la PR, la rama y el SHA actuales de su base y el SHA actual de `main`. Obtén la base y `main` desde las referencias remotas del repositorio destino, mediante la API de GitHub o `git ls-remote`; un `origin/main` local puede estar desactualizado. Si la base es `main`, ambos SHA deben coincidir. En una PR de un fork, conserva también el repositorio de origen.

Registra `head`, `base`, `main` y el merge-base como SHA completos. Descarga los objetos que falten sin cambiar la rama ni el árbol de trabajo. Usa esos SHA inmutables en las búsquedas, lecturas y comandos del diff. Si no puedes obtener cualquiera de las referencias actuales, entrega `Falta`; no uses una revisión previa como evidencia de vigencia.

## Revisar el diff y el destino actual

El diff entre el merge-base y `head` identifica lo que aporta la PR. Además, inspecciona en el SHA actual de `main` los conceptos, responsabilidades y consumidores afectados, incluidos los cambios que se integraron después del merge-base. Si la base es otra rama, inspecciónala también y registra la dependencia con `main`. El diff de la PR por sí solo no muestra lo que otra PR acaba de integrar.

Busca equivalentes por comportamiento y por sinónimos en ambos árboles. Puedes leer archivos con `git show <sha>:<ruta>` y buscar con `git grep` sobre el SHA fijado. Si necesitas `rg`, exporta el árbol a un directorio temporal aislado. No mezcles lecturas del checkout con lecturas de otro commit sin identificar qué versión estás contrastando.

Cuando la rama no incluya el destino actual y haya cambios relacionados desde el merge-base, comprueba la combinación resultante en un entorno temporal aislado, sin modificar la rama ni crear commits, pushes o despliegues. Usa una comprobación de integración sin escritura, un árbol temporal o la referencia de integración de GitHub si puedes demostrar los SHA de sus padres. Ejecuta allí las comprobaciones dirigidas al riesgo. Registra los dos commits combinados y el resultado. Si no puedes comprobar una combinación necesaria, entrega `Falta`. No exijas actualizar la rama solo por estar atrasada cuando la compatibilidad ya esté demostrada.

Un merge sin conflictos de texto no demuestra compatibilidad semántica. Dos módulos con nombres distintos pueden representar la misma responsabilidad, o dos contratos compilar por separado y contradecirse al coexistir.

## PR abiertas que se solapan

Consulta las PR abiertas del repositorio destino y selecciona las que compartan contratos, conceptos, consumidores o responsabilidades con el cambio. Revisa también las dependencias declaradas; el solapamiento puede existir con rutas distintas. Anota sus URL y SHA de origen, además del punto concreto de contacto.

Si dos PR proponen definiciones o implementaciones equivalentes, exige una decisión explícita de implementación canónica, dependencia u orden de integración antes de declarar el cambio listo. La otra PR sigue siendo una propuesta hasta fusionarse; no la trates como contrato vigente. La aprobación de ambas por separado no prueba que sean compatibles juntas.

Si una PR relacionada cambia o se fusiona durante la pasada, renueva esta comprobación. Un cambio sin relación con el alcance no obliga a revisar su contenido, pero todo avance de `main` exige volver a fijar la combinación y contrastar los nuevos commits.

## Invalidar evidencia desactualizada

Vuelve a consultar los SHA remotos de origen, base y `main` antes del veredicto y justo antes de publicarlo. Compáralos con los fijados al iniciar, no solamente con `git rev-parse HEAD`. Renueva también la lista de PR relacionadas y sus SHA y estado para detectar propuestas nuevas, actualizadas o recién fusionadas; revalida el solapamiento si cambió.

- Si cambió `head`, descarta el veredicto anterior y repite la revisión sobre el nuevo diff.
- Si cambió la base o `main`, invalida el veredicto y el borrador aunque `head` siga igual. Fija los nuevos SHA y revisa los commits incorporados, las colisiones semánticas y las validaciones de integración afectadas. Conserva evidencia no afectada solo si explicas por qué sigue siendo válida.
- En `review-ti2-pr`, vuelve a presentar el borrador para confirmación después de revalidarlo; la confirmación anterior cubría otra combinación de commits. Conserva las puertas de CI y Greptile propias de esa skill.

Incluye los SHA de `head`, base y `main` en el informe o comentario publicado. Después de publicar, consulta de nuevo las referencias; si avanzaron, informa que la revisión quedó desactualizada y no la presentes como vigente. Esta comprobación reduce la ventana de carrera, pero no bloquea merges de otras personas. Antes de integrar, la persona responsable debe revalidar contra el `main` de ese momento o usar una cola de integración que pruebe la combinación actual; esta skill no autoriza ni configura ninguna de esas acciones.
