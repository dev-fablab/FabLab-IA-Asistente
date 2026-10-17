import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';

/** Modelo cuyo proveedor falla: sirve para probar el manejo de errores del chat. */
export function failingModel(message = 'proveedor caído') {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw new Error(message);
    },
  });
}

export type ScriptedStep = { tool: { name: string; input: Record<string, unknown> } } | { text: string };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/**
 * Modelo de lenguaje que sigue un guion: cada llamada del agente consume el siguiente paso
 * (llamar a una herramienta o responder con texto). Permite probar el pipeline real de Mastra
 * (herramientas, streaming, historial) sin llamar a ningún proveedor.
 */
export function scriptedModel(steps: ScriptedStep[]) {
  let call = 0;

  return new MockLanguageModelV4({
    doStream: async () => {
      const index = call++;
      const step = steps[Math.min(index, steps.length - 1)]!;

      if ('tool' in step) {
        return {
          stream: convertArrayToReadableStream([
            { type: 'stream-start' as const, warnings: [] },
            {
              type: 'tool-call' as const,
              toolCallId: `call-${index}`,
              toolName: step.tool.name,
              input: JSON.stringify(step.tool.input),
            },
            { type: 'finish' as const, finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' }, usage },
          ]),
        };
      }

      return {
        stream: convertArrayToReadableStream([
          { type: 'stream-start' as const, warnings: [] },
          { type: 'text-start' as const, id: `text-${index}` },
          { type: 'text-delta' as const, id: `text-${index}`, delta: step.text },
          { type: 'text-end' as const, id: `text-${index}` },
          { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'stop' }, usage },
        ]),
      };
    },
  });
}
