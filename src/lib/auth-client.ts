import { createAuthClient } from 'better-auth/client';

// Same-origin client; baseURL is inferred from the page origin.
export const authClient = createAuthClient();
export const { signUp, signIn, signOut, useSession } = authClient;
