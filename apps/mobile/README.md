# Mobile Sprint 1 client layer

The files under `src/` contain **provisional client models** and a replaceable
`MobileClient` port for the Sprint 1 demonstration. They are not canonical
CERETI domain contracts and are not a second source of truth. The future TI2
adapter should map its approved API responses to `StudentAreaSnapshot` without
requiring screens to import storage or transport details.

`App.tsx` is the isolated consumption example: it wires the demo-only
`createMockMobileClient()` at the composition root and passes only the
`MobileClient` boundary to `StudentAreaExample`.

All mock values are fictional and use an invalid example email domain. No real
student data, backend, Convex code, or TI2 contract is used.
