# Issue Tracker

## Provider

Usa Linear mediante el MCP `linear`.

- Workspace: `ceretime`
- Equipos: `TI4` (`1c1a408e-edaa-4019-b5f1-245af9843333`) y `TI2` (`4a5c905f-52a0-4862-94c5-c7718cecd3be`)
- Las issues usan claves `TI4-*` y `TI2-*`.

## Capacidades permitidas

- Leer issues, comentarios, relaciones de bloqueo y datos del workspace.
- Crear comentarios, cambiar estados o cerrar issues solo con pedido explícito.

## Reglas de trabajo por issue

Se aplican issue por issue, al inicio de cada sesión:

1. **La issue manda sobre el prompt.** Si el prompt y la issue chocan en alcance, la issue es la fuente de verdad y el agente avisa antes de hacer otra cosa. Si en cualquier punto la conversación contradice la planificación inicial, se para el trabajo y se refina el entendimiento compartido: el agente formula las dudas con la skill `to-questionnaire` para que el scrum master las resuelva antes de continuar.
2. **Leer antes de trabajar.** Descripción, criterios de aceptación, dependencias, fuera de alcance y evidencia de cierre. Los criterios son el checklist de verificación final.
3. **Respetar exclusiones y vecinas.** No implementar lo excluido ni absorber trabajo de issues relacionadas aunque parezca cercano.
4. **Linear manda sobre la ejecución.** La issue vigente define el alcance operativo, la prioridad, las dependencias, el estado, los responsables, los criterios y la evidencia de cierre. `CONTEXT.md`, `DESIGN.md`, `docs/` y los ADR conservan el vocabulario y las decisiones estables; si la issue exige modificar una de esas fuentes, actualiza esa fuente por su flujo y sigue la issue vigente. Los cambios de lenguaje del dominio van en `CONTEXT.md`; si una issue cambia una decisión arquitectónica aceptada, crea o actualiza un ADR antes de cerrarla.
5. **No tocar estados sin permiso.** Al terminar, entregar el texto de evidencia listo para pegar en Linear.
