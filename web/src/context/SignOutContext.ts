import { createContext, useContext } from 'react';

/** How to sign out, provided once at the top so screens deep in the tree can offer it. */
export const SignOutContext = createContext<(() => void) | undefined>(undefined);

export const useSignOut = () => useContext(SignOutContext);
