import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from 'react';

import type { NavigationRole } from './roles';

type NavigationSession = {
  role: NavigationRole | null;
  selectRole: (role: NavigationRole) => void;
  clearSession: () => void;
};

const SessionContext = createContext<NavigationSession | null>(null);

// Sólo permite recorrer el prototipo. TI4-7 sustituirá esta sesión en memoria.
export function NavigationSessionProvider({ children }: PropsWithChildren) {
  const [role, setRole] = useState<NavigationRole | null>(null);

  return (
    <SessionContext.Provider
      value={{ role, selectRole: setRole, clearSession: () => setRole(null) }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useNavigationSession() {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error('La navegación necesita NavigationSessionProvider.');
  }
  return session;
}
