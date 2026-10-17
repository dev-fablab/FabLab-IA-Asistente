import type { LogFields, Logger } from '../logger';

/**
 * Resúmenes de lo que hizo el agente para el registro. Solo cantidades, nombres de herramientas y
 * estados: ni el texto de la persona, ni el de la respuesta, ni los fragmentos recuperados.
 */

type UsageLike = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

type ToolResultLike = { payload: { toolName: string; result: unknown; isError?: boolean } };

/** Lo mínimo de un paso del agente; compatible con `LLMStepResult` de Mastra. */
export type StepLike = {
  finishReason?: string;
  usage?: UsageLike;
  text?: string;
  toolResults?: ReadonlyArray<ToolResultLike>;
  /** Con modelos de respaldo, el que respondió el paso (puede no ser el principal). */
  model?: { modelId?: string };
  response?: { modelId?: string };
};

export type FinishLike = {
  finishReason?: string;
  totalUsage?: UsageLike;
  steps: readonly StepLike[];
  model?: { modelId?: string };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export function summarizeUsage(usage: UsageLike | undefined): LogFields {
  return { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, totalTokens: usage?.totalTokens };
}

/** Resultado de una herramienta: si falló, si quedó `unavailable`, si encontró algo y cuántos elementos devolvió. */
export function summarizeToolResult({ toolName, result, isError }: ToolResultLike['payload']): LogFields {
  const data = isRecord(result) ? result : {};
  const items = [data.passages, data.matches, data.channels].find(Array.isArray);
  const scores = Array.isArray(data.passages)
    ? data.passages.map((passage) => (isRecord(passage) ? passage.score : undefined)).filter((score): score is number => typeof score === 'number')
    : [];

  return {
    tool: toolName,
    ...(isError && { error: true }),
    ...(data.unavailable === true && { unavailable: true }),
    ...(typeof data.found === 'boolean' && { found: data.found }),
    ...(items && { count: items.length }),
    // La mejor similitud ayuda a calibrar el umbral de recuperación.
    ...(scores.length > 0 && { topScore: Math.max(...scores) }),
  };
}

export function summarizeStep(step: StepLike): LogFields {
  return {
    finishReason: step.finishReason,
    model: step.model?.modelId ?? step.response?.modelId,
    ...summarizeUsage(step.usage),
    textChars: step.text?.length ?? 0,
    tools: step.toolResults?.length ? step.toolResults.map(({ payload }) => summarizeToolResult(payload)) : undefined,
  };
}

export function summarizeFinish(event: FinishLike): LogFields {
  return {
    finishReason: event.finishReason,
    steps: event.steps.length,
    // El modelo que cerró el turno: si no es el principal, hubo cambio al respaldo.
    model: event.model?.modelId ?? event.steps.at(-1)?.response?.modelId,
    ...summarizeUsage(event.totalUsage),
  };
}

/**
 * Sigue el avance del stream del modelo: registra (a nivel `debug`) la primera vez que llega cada tipo de
 * chunk con su tiempo, y los errores del stream siempre. Así se ve si el modelo arrancó (`step-start`),
 * si solo está razonando (`reasoning-delta`, que no se envía a la persona) o si ya escribe (`text-delta`).
 */
export function createChunkLogger(log: Logger, elapsed: () => number) {
  const seen = new Set<string>();
  return (chunk: { type: string; payload?: unknown }) => {
    if (chunk.type === 'error' || chunk.type === 'tool-error') {
      const payload = isRecord(chunk.payload) ? chunk.payload : {};
      log.error('chat.chunk_error', payload.error ?? chunk.payload, { chunk: chunk.type, ms: elapsed() });
    } else if (!seen.has(chunk.type)) {
      seen.add(chunk.type);
      log.debug('chat.chunk', { type: chunk.type, ms: elapsed() });
    }
  };
}
