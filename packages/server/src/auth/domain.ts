/** Correo institucional del personal. El registro público sigue cerrado. */
export const STAFF_EMAIL_DOMAIN = 'inacapmail.cl';

export const ADMIN_EMAIL = 'admin@inacapmail.cl';
export const STAFF_EMAIL = 'staff@inacapmail.cl';

export const DOMAIN_ERROR = 'El correo debe ser @inacapmail.cl';
export const LOGIN_ERROR = 'Correo o contraseña incorrectos.';

const STAFF_EMAIL_PATTERN = /^[^\s@]+@inacapmail\.cl$/;

export function normalizeStaffEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Anclado al dominio: rechaza `a@inacapmail.cl.otro.com`. */
export function isStaffDomainEmail(email: string): boolean {
  return STAFF_EMAIL_PATTERN.test(normalizeStaffEmail(email));
}

export function isSeedEmail(email: string): boolean {
  const normalized = normalizeStaffEmail(email);
  return normalized === ADMIN_EMAIL || normalized === STAFF_EMAIL;
}

/** Parte local del correo, usada como nombre visible. */
export function emailLocalPart(email: string): string {
  const local = normalizeStaffEmail(email).split('@')[0];
  return local && local.length > 0 ? local : 'staff';
}
