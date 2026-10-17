import type { ProfileRole } from '@fablab/db';

/** Persona del equipo que superó `requireStaff`. */
export type StaffContext = {
  id: string;
  email: string;
  role: ProfileRole;
};

/** Variables que los middlewares dejan en el contexto de Hono. */
export type AppEnv = {
  Variables: {
    staff: StaffContext;
  };
};

/**
 * Ejecuta trabajo después de responder (ingesta de documentos). La app web inyecta
 * `after` de Next.js; un servicio Node propio podría inyectar una cola. Así este
 * paquete no depende de Next.js.
 */
export type ScheduleBackground = (task: () => Promise<void>) => void;

/** Dependencias de autenticación; se inyectan para poder probar `requireStaff` sin base de datos. */
export interface AuthDeps {
  /** Valida firma, emisor, audiencia y vigencia del JWT. Devuelve `null` si no es válido. */
  verifyToken(token: string): Promise<{ userId: string } | null>;
  /** Perfil del usuario o `null` si no existe (sin perfil no hay acceso al panel). */
  findProfile(userId: string): Promise<StaffContext | null>;
}
