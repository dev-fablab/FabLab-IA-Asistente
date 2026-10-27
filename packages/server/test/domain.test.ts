import { describe, expect, it } from 'vitest';
import { isSeedEmail, isStaffDomainEmail, normalizeStaffEmail } from '../src/auth/domain';

describe('correo institucional', () => {
  it('acepta @inacapmail.cl en minúsculas y con espacios', () => {
    expect(isStaffDomainEmail('  Ana@INACAPMAIL.cl ')).toBe(true);
    expect(normalizeStaffEmail('  Ana@INACAPMAIL.cl ')).toBe('ana@inacapmail.cl');
  });

  it('rechaza otro dominio, un subdominio y un sufijo pegado', () => {
    expect(isStaffDomainEmail('ana@otro.cl')).toBe(false);
    expect(isStaffDomainEmail('ana@mail.inacapmail.cl')).toBe(false);
    expect(isStaffDomainEmail('a@inacapmail.cl.evil.com')).toBe(false);
    expect(isStaffDomainEmail('inacapmail.cl')).toBe(false);
    expect(isStaffDomainEmail('@inacapmail.cl')).toBe(false);
  });

  it('reconoce solo las dos cuentas predeterminadas', () => {
    expect(isSeedEmail('Admin@inacapmail.cl')).toBe(true);
    expect(isSeedEmail('staff@inacapmail.cl')).toBe(true);
    expect(isSeedEmail('otra@inacapmail.cl')).toBe(false);
  });
});
