import { Hono } from 'hono';
import { listTeam } from '../services/team';
import type { AppEnv } from '../types';

/** Personas del equipo (staff y admin), para elegir al responsable de una reunión. */
export function createTeamRoutes() {
  return new Hono<AppEnv>().get('/', async (c) => c.json({ members: await listTeam() }));
}
