# Patrones de implementación

Estos patrones son guías compartidas para implementar y revisar cambios en CERETIME. El equipo propietario implementa en su área; una guía en esta carpeta no cambia el ownership ni autoriza editar otro equipo. Si una propuesta requiere cambiar un contrato o una decisión, acuerda el cambio con sus responsables antes de implementarlo.

| Cuándo consultarlo                                                          | Patrón                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------- |
| Responsabilidades, dependencias y composición de un caso de uso             | [Arquitectura por capas](arquitectura-por-capas.md)     |
| Acceso a datos, acciones por rol o cambios de permisos                      | [Autorización por identidad y recurso](autorizacion.md) |
| Campos, estados, errores o funciones consumidas entre Web, Mobile y Backend | [Contratos compartidos](contratos.md)                   |

Cada patrón parte de un problema real y apunta a código o documentación existente. Añade otro cuando haya una decisión recurrente que el código por sí solo no explique; evita copiar implementaciones completas que puedan quedar obsoletas.
