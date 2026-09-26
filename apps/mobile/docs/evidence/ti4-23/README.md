# Validación de permisos del Administrador, TI4-23

El flujo Mobile usa datos ficticios y el adaptador local de cuentas. Las capturas de habilitación permitida y rechazada están en la [evidencia de TI4-11](../ti4-11/README.md).

## Checklist

- [x] Una cuenta institucional pendiente se habilita y muestra confirmación. La prueba de integración recorre Inicio, Habilitación de cuentas y el nuevo estado.
- [x] Una cuenta fuera de los dominios institucionales conserva el estado pendiente y muestra un error controlado que permite reintentar.
- [x] Habilitar una cuenta no concede acceso a acompañamientos. Una ruta directa de Practicante devuelve al Administrador sin consultar acompañamientos asignados.
- [x] Una ruta directa de solicitudes profesionales devuelve al Administrador sin consultar solicitudes ni agenda.
- [x] Las rutas y el puerto del Administrador sólo ofrecen inicio, perfil, lista y habilitación de cuentas. No ofrecen asignación de acompañamientos, notas internas, auditoría completa ni reportes avanzados.
- [ ] Capturar en Android el rechazo de las rutas de otros roles tras habilitar una cuenta. El Pixel 5 gestionado no arrancó porque el helper no encontró el SDK de Android y no había un servidor Expo activo.

## Comprobaciones

`bun run --cwd apps/mobile test -- --runTestsByPath __tests__/administrator-accounts.test.tsx __tests__/navigation.test.tsx __tests__/professional-review.test.tsx` terminó con 36 pruebas aprobadas. Comprueba los casos permitidos, rechazados y de navegación entre roles, además del flujo profesional. La prueba de acceso directo confirma que los lectores de Practicante y Profesional no se llaman con una sesión de Administrador.
