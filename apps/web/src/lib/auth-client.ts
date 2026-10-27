'use client';

import { createAuthClient } from 'better-auth/react';

/** Cliente del navegador. Mismo origen: la cookie de sesión la guarda Better Auth. */
export const authClient = createAuthClient({
  basePath: '/api/auth',
});
