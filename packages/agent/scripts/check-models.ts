/**
 * Verifica contra las APIs reales (embeddings de NVIDIA NIM, chat con el proveedor de `CHAT_MODELS`) lo que las
 * pruebas automáticas no pueden:
 *
 *   pnpm models:check
 *
 * 1. Embeddings: el modelo responde, la dimensión coincide con la columna `vector` y lo relevante queda
 *    más cerca que lo ajeno. Imprime las similitudes para calibrar `RETRIEVAL_MIN_SCORE`.
 * 2. Cada modelo de `CHAT_MODELS`, por separado: responde, **llama herramientas** (el agente las necesita
 *    para buscar en los documentos), termina sin cortarse y cuánto cuesta en tokens y tiempo.
 * 3. Respaldo: con un primer modelo inexistente, ¿responde el siguiente?
 *
 * Usa `apps/web/.env.local` (OPENROUTER_API_KEY, NVIDIA_API_KEY, CHAT_MODELS, EMBEDDING_MODEL…). Sale con código 1 si falla
 * el punto 1 o 2; el 3 es informativo.
 */
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { embedDocuments, embedQuery } from '../src/embeddings';
import { ConfigurationError, getChatEnv, getEmbeddingEnv } from '../src/env';
import { getChatModelSettings, NVIDIA_NIM_BASE_URL } from '../src/models';

const PROMPT = 'Usa la herramienta ping con el texto "hola" y luego dime, en una frase corta, qué te devolvió.';

const ping = createTool({
  id: 'ping',
  description: 'Devuelve el texto recibido en mayúsculas. Úsala cuando te lo pidan.',
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ echo: z.string() }),
  execute: async ({ text }) => ({ echo: text.toUpperCase() }),
});

/** Nunca se imprime la clave, ni siquiera dentro de un mensaje de error del proveedor. */
function scrub(message: string): string {
  const clean = [process.env.NVIDIA_API_KEY, process.env.OPENROUTER_API_KEY].reduce(
    (text: string, key) => (key ? text.split(key).join('***') : text),
    message,
  );
  return clean.replace(/nvapi-[\w-]+/g, 'nvapi-***').replace(/sk-or-[\w-]+/g, 'sk-or-***').slice(0, 400);
}

const describeError = (error: unknown) => scrub(error instanceof Error ? `${error.name}: ${error.message}` : String(error));

const ms = (start: number) => `${((performance.now() - start) / 1000).toFixed(1)} s`;

const cosine = (a: number[], b: number[]) => {
  const dot = a.reduce((sum, value, index) => sum + value * b[index]!, 0);
  const norm = (v: number[]) => Math.sqrt(v.reduce((sum, value) => sum + value * value, 0));
  return dot / (norm(a) * norm(b));
};

let failed = false;
const fail = () => {
  failed = true;
};

async function checkEmbeddings() {
  const { EMBEDDING_MODEL, EMBEDDING_DIMENSION } = getEmbeddingEnv();
  console.log(`\n── Embeddings: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSION} dimensiones) ──`);

  const docs = [
    'Fab Lab ofrece impresión 3D, corte láser y electrónica para toda la comunidad.',
    'El laboratorio atiende de lunes a viernes, de 9:00 a 18:00 horas.',
  ];
  const start = performance.now();
  try {
    const [servicios, horario] = await embedDocuments(docs);
    const relevant = await embedQuery('¿Qué servicios de fabricación digital ofrecen?');
    const unrelated = await embedQuery('¿Quién ganó el último mundial de fútbol?');
    console.log(`  OK  respuesta en ${ms(start)}; la dimensión coincide con la columna vector (${servicios!.length})`);

    const rows = [
      ['pregunta relevante  → doc de servicios', cosine(relevant, servicios!)],
      ['pregunta relevante  → doc de horario  ', cosine(relevant, horario!)],
      ['pregunta ajena      → doc de servicios', cosine(unrelated, servicios!)],
      ['pregunta ajena      → doc de horario  ', cosine(unrelated, horario!)],
    ] as const;
    for (const [label, score] of rows) console.log(`      ${label}  similitud ${score.toFixed(3)}`);

    const [onTopic, offTopic] = [Math.max(rows[0][1], rows[1][1]), Math.max(rows[2][1], rows[3][1])];
    if (onTopic > offTopic) {
      console.log(`  OK  lo relevante queda más cerca que lo ajeno (${onTopic.toFixed(2)} frente a ${offTopic.toFixed(2)})`);
    } else {
      console.log('  FALLA  lo ajeno quedó tan cerca como lo relevante: el modelo no discrimina');
      fail();
    }
    console.log(
      `  i   RETRIEVAL_MIN_SCORE debe quedar entre lo ajeno (${offTopic.toFixed(2)}) y lo relevante (${onTopic.toFixed(2)}): ` +
        'el 0,70 inicial del spec se pensó para otro modelo y hay que recalibrarlo con documentos reales.',
    );
  } catch (error) {
    console.log(`  FALLA  ${describeError(error)}`);
    fail();
  }
}

type ChatResult = { ok: boolean; line: string };

async function runChat(models: { id: string; model: string; maxRetries: number }[]): Promise<ChatResult & { answer?: string }> {
  const agent = new Agent({
    id: 'models-check',
    name: 'models-check',
    instructions: 'Eres un asistente de pruebas. Responde siempre en español y muy breve.',
    model: models,
    tools: { ping },
  });

  const start = performance.now();
  try {
    const output = await agent.stream(PROMPT, { maxSteps: 3, modelSettings: { ...getChatModelSettings() } });
    const [text, toolResults, finishReason, usage] = await Promise.all([output.text, output.toolResults, output.finishReason, output.usage]);

    const calledTool = toolResults.some((result) => result.payload.toolName === 'ping');
    const reasoning = usage.reasoningTokens ?? 0;
    const cut = finishReason === 'length';
    const answer = text.trim();
    const ok = calledTool && answer.length > 0 && !cut;

    const problems = [
      !calledTool && 'no llamó a la herramienta',
      answer.length === 0 && 'respuesta vacía',
      cut && 'respuesta cortada por el tope de salida (sube CHAT_MAX_OUTPUT_TOKENS)',
    ].filter(Boolean);

    return {
      ok,
      answer,
      line:
        `${ok ? 'OK    ' : 'FALLA '} ${ms(start)} · herramienta: ${calledTool ? 'sí' : 'NO'} · fin: ${finishReason}` +
        ` · tokens ${usage.inputTokens ?? '?'}→${usage.outputTokens ?? '?'}${reasoning ? ` (razonamiento ${reasoning})` : ''}` +
        (problems.length ? ` · ${problems.join('; ')}` : ''),
    };
  } catch (error) {
    return { ok: false, line: `FALLA  ${ms(start)} · ${describeError(error)}` };
  }
}

async function checkChatModels() {
  const { CHAT_MODELS } = getChatEnv();
  const settings = getChatModelSettings();
  console.log(`\n── Modelos de chat (temperatura ${settings.temperature}, tope de salida ${settings.maxOutputTokens}) ──`);

  for (const model of CHAT_MODELS) {
    console.log(`\n  ${model}`);
    const result = await runChat([{ id: model, model, maxRetries: 0 }]);
    console.log(`    ${result.line}`);
    if (result.answer) console.log(`    respuesta: «${result.answer.replace(/\s+/g, ' ').slice(0, 160)}»`);
    if (!result.ok) fail();
  }

  const primary = CHAT_MODELS[0]!;
  const missing = `${primary.split('/')[0]}/modelo/que-no-existe`;
  console.log(`\n  Respaldo: primero «${missing}» y luego «${primary}»`);
  const fallback = await runChat([
    { id: missing, model: missing, maxRetries: 0 },
    { id: primary, model: primary, maxRetries: 0 },
  ]);
  console.log(`    ${fallback.line}`);
  console.log(
    fallback.ok
      ? '    El respaldo se activó ante un modelo que falla.'
      : '    El respaldo NO se activó ante un modelo inexistente. Mastra lo documenta para errores 5xx, límite de tasa y tiempo agotado; ' +
          'un modelo inexistente (404) puede no contar. Es informativo y no afecta el resultado.',
  );
}

console.log(`Endpoint de NIM: ${NVIDIA_NIM_BASE_URL}`);
try {
  await checkEmbeddings();
  await checkChatModels();
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(`\n${error.message}\nCompleta apps/web/.env.local (OPENROUTER_API_KEY, NVIDIA_API_KEY, CHAT_MODELS, EMBEDDING_MODEL).`);
  } else {
    console.error(`\n${describeError(error)}`);
  }
  process.exit(1);
}

console.log(failed ? '\nHay verificaciones que fallaron.' : '\nTodo en orden.');
process.exit(failed ? 1 : 0);
