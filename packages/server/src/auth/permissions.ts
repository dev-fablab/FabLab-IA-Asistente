import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';

/**
 * Permisos del plugin de administración. No incluyen ban ni impersonación:
 * esas acciones no forman parte del panel.
 */
const statements = createAccessControl(defaultStatements);

export const adminRole = statements.newRole({
  user: ['create', 'list', 'get', 'update', 'set-role', 'set-password', 'set-email', 'delete'],
  session: [],
});

/** El personal entra al panel, pero no administra cuentas. */
export const staffRole = statements.newRole({
  user: [],
  session: [],
});

export const accessControl = statements;

export const authRoles = {
  admin: adminRole,
  staff: staffRole,
};
