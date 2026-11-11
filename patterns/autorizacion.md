# Autorización por identidad y recurso

Aplica este patrón al leer o modificar datos protegidos. Un rol habilitado no implica acceso a cualquier documento: la relación con la solicitud, el acompañamiento o la atención también importa.

1. En el borde público, obtén la identidad del contexto de Convex. Un ID recibido como argumento identifica el recurso, no demuestra quién hace la petición.
2. Resuelve el perfil y las relaciones necesarias en el servidor. Evalúa el rol, la vigencia y el alcance de la operación con las políticas existentes; no confíes en un guard de navegación como barrera de seguridad.
3. Devuelve solo la vista autorizada y usa la denegación pública correspondiente sin revelar la existencia de recursos ajenos.
4. Prueba el acceso permitido y el denegado: sin identidad, con rol incorrecto y con recurso ajeno o relación revocada, según el caso. Comprueba también que la respuesta no filtre detalles.

El borde de [solicitudes](../convex/presentation/requests.ts) obtiene la identidad y delega en Aplicación. [Autorización](../convex/application/authorization/authorize.ts) construye el contexto y utiliza las políticas de Dominio; [practitionerContracts.test.ts](../convex/tests/practitionerContracts.test.ts) muestra comprobaciones negativas. Son referencias para entender el flujo, no una autorización para copiar un caso sin revisar sus precondiciones.
