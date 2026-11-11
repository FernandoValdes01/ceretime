# Calidad de la base de código

Aplica estas comprobaciones cuando el diff afecte lógica o contratos. El objetivo es que cada responsabilidad tenga un lugar claro y cada concepto del dominio conserve su significado entre Web, Backend y Mobile. Revisa el cambio y el código relacionado en la base y el estado actual; una búsqueda en todo el repositorio sirve para encontrar equivalentes, no para exigir una limpieza general.

## Buscar antes de aceptar código nuevo

Por cada regla, tipo de dominio, caso de uso, adaptador o componente con lógica que el cambio añada o modifique, busca responsabilidades equivalentes con `rg` y `rg --files`. Busca por comportamiento y por los sinónimos usados en el proyecto, además del nombre del símbolo. Lee las coincidencias relevantes, sus consumidores y sus pruebas; que una búsqueda no encuentre el nombre exacto no demuestra que la responsabilidad sea nueva.

Compara la base y el cambio completo, incluidos los cambios sin commit, para distinguir lo introducido, lo agravado y lo que ya existía. Para cerrar esta comprobación debes poder señalar la implementación canónica reutilizada, justificar por qué las implementaciones son distintas o identificar la duplicación y los consumidores afectados.

## Duplicación de responsabilidades

Registra un hallazgo cuando el cambio introduzca o agrave alguno de estos casos:

- Una regla de negocio o autorización vuelve a implementarse en otro módulo o en un cliente. Una comprobación de interfaz puede mejorar la experiencia, pero la decisión autorizada permanece en el Backend.
- Roles, estados, entidades o contratos se redefinen manualmente en varios lugares y obligan a sincronizar cambios. Comprueba dónde se define el concepto y cómo se derivan los tipos y validadores. Un esquema de persistencia o un contrato de transporte puede tener una forma distinta si existe una conversión explícita y no duplica la política del dominio.
- Dos casos de uso, consultas, adaptadores o componentes mantienen el mismo comportamiento con nombres o ubicaciones diferentes. Señala ambas implementaciones y qué corrección futura habría que repetir.
- Un nuevo helper o módulo copia una responsabilidad existente en vez de consumirla, o envuelve otra función sin aportar un contrato, una conversión o una política necesaria.

Propón reutilizar la implementación canónica o concentrar la responsabilidad repetida en un módulo con una interfaz clara. La semejanza visual, dos fragmentos cortos o pruebas con escenarios diferentes no bastan para exigir una abstracción. Una extracción debe reducir puntos de mantenimiento sin acoplar comportamientos que cambian por razones distintas.

## Lenguaje del dominio entre capas

Para cada concepto afectado, contrasta `CONTEXT.md`, los ADR pertinentes, el contrato público, el esquema, los tipos, las funciones, las rutas, los textos visibles y las pruebas que lo consumen. Registra el concepto, sus nombres encontrados y la definición canónica con su fuente. Linear fija el alcance de la tarea; el lenguaje del producto se contrasta con las fuentes oficiales del dominio.

Consulta `docs/vocabulario-codigo.md` para los nombres acordados y contrasta los contratos existentes antes de cambiar valores o interfaces. Si el cambio usa sinónimos, comprueba si corresponden a una traducción externa necesaria o si mantienen dos vocabularios internos para la misma responsabilidad.

Registra un hallazgo cuando los sinónimos creen tipos, valores de rol, módulos o API paralelos sin una frontera justificada, o cuando un mismo nombre designe conceptos diferentes. El hallazgo debe citar los nombres, sus ubicaciones y la ambigüedad o mantenimiento duplicado que producen. No hace falta esperar un error en ejecución para corregir un modelo contradictorio.

Acepta una traducción exigida por una API externa o un alias de compatibilidad cuando esté confinado al adaptador o punto de entrada, tenga una conversión explícita y no propague dos modelos internos. Si la decisión canónica no está documentada y no puede resolverse con las fuentes vigentes, pide aclararla antes de aprobar el contrato. Los textos de interfaz pueden estar en español mientras los identificadores están en inglés; la consistencia exigida es de significado.

## Estructura y responsabilidad de los módulos

Ubica cada archivo nuevo o modificado en la capa y módulo responsables. Comprueba sus imports, exports y consumidores contra las reglas del repositorio y los módulos vecinos. Examina especialmente archivos nuevos de utilidades, puntos de entrada y módulos que concentran varias responsabilidades.

Cuando haya cambios de lógica, módulos, interfaces, adaptadores o dependencias, lee y aplica `../../codebase-design/SKILL.md`. Registra por responsabilidad el módulo canónico, su interfaz y consumidores, qué complejidad concentra y qué justifica su separación. Comprueba si eliminar una capa solo reduce intermediarios o dispersa reglas entre consumidores, y si las pruebas ejercitan la interfaz usada por estos. La existencia de carpetas por capas no demuestra que el diseño cumpla esos criterios. Una capa fina requerida por la arquitectura o un adaptador necesario debe evaluarse por su responsabilidad, no por su tamaño.

Registra un hallazgo si hay una consecuencia concreta como:

- Reglas de dominio repartidas entre handlers, componentes y adaptadores, con varios lugares que deben cambiar juntos.
- Persistencia, React, autenticación concreta o tipos generados que penetran el dominio e impiden probarlo de forma independiente.
- Módulos paralelos para una misma capacidad o archivos ubicados en una capa que invierte la dirección de dependencias.
- Imports internos que evaden el punto de entrada acordado, dependencias circulares o barrels que exponen implementaciones privadas como contrato público.
- Código de producción sin consumidores ni un uso requerido por el issue, implementaciones antiguas que el cambio reemplaza pero deja activas o pruebas que siguen validando la versión abandonada.

Describe qué responsabilidad está mal ubicada, qué dependencia o mantenimiento genera y cuál es la corrección mínima. La longitud de un archivo, el nombre `utils` o una preferencia de organización no constituyen un hallazgo por sí solos.

## Corrección y compatibilidad

Para una consolidación o un cambio de nombre, recorre los consumidores de Web y Mobile, las exportaciones públicas, los valores persistidos, los validadores y las pruebas. Exige una conversión o migración cuando cambien valores almacenados o contratos consumidos. Cambiar nombres de archivos no demuestra que se eliminaron las responsabilidades duplicadas.

Valida los riesgos identificados con pruebas existentes o una comprobación dirigida: una regla tiene el mismo comportamiento para los consumidores, un contrato se importa desde su punto de entrada o un valor persistido sigue siendo legible. Registra el resultado real; una búsqueda de texto es evidencia de ubicación, no prueba de comportamiento.

Una deuda previa que el cambio no agrava ni necesita resolver para cumplir la issue se informa aparte con ubicación y efecto. Si el cambio la copia, la extiende o depende de una contradicción para funcionar, vincula el hallazgo a esa parte. Una reestructuración futura no justifica integrar duplicación nueva.

## Evidencia y criterio de cierre

En el informe incluye una tabla breve con las comprobaciones de duplicación, lenguaje, estructura y compatibilidad. Por cada una registra `verificada`, `con hallazgo`, `no aplica` o `no verificable`, junto con las rutas comparadas y la evidencia. Justifica `no aplica` por el alcance y `no verificable` por el dato o acceso faltante. Para documentación o configuración aplica los criterios pertinentes, sin inventar una revisión de lógica que no cambió.

Cada hallazgo debe señalar el cambio que lo introduce o agrava, la implementación o definición con la que entra en conflicto, la consecuencia concreta, la corrección mínima y cómo comprobarla. Agrupa los problemas que se resuelven con una sola corrección.
