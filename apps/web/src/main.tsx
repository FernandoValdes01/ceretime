import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ConvexBetterAuthProvider,
  type AuthClient,
} from '@convex-dev/better-auth/react'
import './index.css'
import App from './App.tsx'
import { authClient } from './infrastructure/auth/auth-client.ts'
import { convexClient } from './infrastructure/convex/convex-client.ts'

// Cast acotado a este borde: Bun aísla `better-auth` por workspace y el `tsc`
// local ve copias idénticas (v1.6.31) como tipos distintos. En ejecución es el
// mismo cliente; el despliegue no se ve afectado.
const typedAuthClient = authClient as unknown as AuthClient

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexBetterAuthProvider client={convexClient} authClient={typedAuthClient}>
      <App />
    </ConvexBetterAuthProvider>
  </StrictMode>,
)
