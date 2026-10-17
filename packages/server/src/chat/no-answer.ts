const SEARCH_TOOL = 'searchDocuments';

/** Lo mínimo que se necesita de un paso del agente; compatible con `LLMStepResult` de Mastra. */
export type AgentStepLike = {
  text?: string;
  toolResults?: ReadonlyArray<{ payload: { toolName: string; result: unknown; isError?: boolean } }>;
};

const isUnavailable = (result: unknown) =>
  typeof result === 'object' && result !== null && (result as { unavailable?: unknown }).unavailable === true;

/**
 * Un turno es «sin información» cuando la última búsqueda que funcionó devolvió `found: false`. Un
 * turno sin búsqueda (saludo, tema ajeno, agendar) no lo es, y tampoco uno cuya búsqueda falló
 * (`isError` o `unavailable: true`): un error técnico no es un vacío documental. Esta marca alimenta
 * el filtro del historial que le muestra al equipo qué falta documentar.
 */
export function detectNoAnswer(steps: readonly AgentStepLike[]): boolean {
  let last: unknown;
  for (const step of steps) {
    for (const { payload } of step.toolResults ?? []) {
      if (payload.toolName === SEARCH_TOOL && !payload.isError && !isUnavailable(payload.result)) last = payload.result;
    }
  }
  return typeof last === 'object' && last !== null && (last as { found?: unknown }).found === false;
}

/** Texto completo que vio la persona: el de todos los pasos, no solo el del último. */
export function textOfSteps(steps: readonly AgentStepLike[], fallback = ''): string {
  const joined = steps
    .map((step) => step.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');
  return joined || fallback.trim();
}
