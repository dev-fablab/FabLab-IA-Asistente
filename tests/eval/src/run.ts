/**
 * Evaluación del agente (spec §14): corre cada pregunta del conjunto por `fabLabAgent`, registra la
 * respuesta, las fuentes y los puntajes de similitud, y aplica las comprobaciones automáticas.
 *
 *   pnpm eval                 # todo el conjunto
 *   pnpm eval -- --only no-coverage
 *
 * Usa los mismos modelos y la misma base que la app (apps/web/.env.local): hace falta una clave de
 * OpenRouter y documentos cargados. Repetirla al cambiar instrucciones, modelo, umbral o troceo.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fabLabAgent } from '@fablab/agent';
import { evaluate, lastSearch, type AgentRun, type Evaluation } from './checks';
import { CATEGORIES, countByCategory, loadQuestionSet, TARGET_COUNTS, type Category, type Question } from './questions';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { only: { type: 'string' } },
});

async function ask(question: string): Promise<AgentRun> {
  const result = await fabLabAgent.generate([{ role: 'user', content: question }]);
  const toolCalls = result.steps.flatMap((step) =>
    step.toolResults.map((toolResult) => ({ name: toolResult.payload.toolName, result: toolResult.payload.result as unknown })),
  );
  return { answer: result.text, toolCalls };
}

type Row = { question: Question; run: AgentRun; evaluation: Evaluation };

const set = loadQuestionSet();
const only = values.only as Category | undefined;
if (only && !CATEGORIES.includes(only)) throw new Error(`--only debe ser una de: ${CATEGORIES.join(', ')}`);

const pending = set.questions.filter((q) => q.pending);
const toRun = set.questions.filter((q) => !q.pending && (!only || q.category === only));

if (set.provisional) {
  console.log('⚠ Conjunto PROVISIONAL: las preguntas reales las arma Fab Lab (spec §14). Los resultados orientan, no aceptan.\n');
}

const rows: Row[] = [];
for (const question of toRun) {
  process.stdout.write(`[${question.category}] ${question.id} … `);
  try {
    const run = await ask(question.question);
    const evaluation = evaluate(question, run);
    rows.push({ question, run, evaluation });
    console.log(evaluation.pass ? 'OK' : 'FALLA', evaluation.needsReview ? '(revisar)' : '');
  } catch (error) {
    // Un error del modelo o de configuración no es un resultado de la pregunta: se informa y se sigue.
    console.log('ERROR', error instanceof Error ? error.message : error);
    rows.push({
      question,
      run: { answer: '', toolCalls: [] },
      evaluation: { pass: false, needsReview: false, checks: [{ name: 'el agente respondió', ok: false, detail: String(error) }] },
    });
  }
}

const failed = rows.filter((row) => !row.evaluation.pass);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(import.meta.dirname, '..', 'results');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${stamp}.json`);

writeFileSync(
  outFile,
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      provisional: set.provisional,
      chatModels: process.env.CHAT_MODELS ?? null,
      embeddingModel: process.env.EMBEDDING_MODEL ?? null,
      minScore: process.env.RETRIEVAL_MIN_SCORE ?? null,
      topK: process.env.RETRIEVAL_TOP_K ?? null,
      results: rows.map(({ question, run, evaluation }) => ({
        id: question.id,
        category: question.category,
        question: question.question,
        answer: run.answer,
        sources: (lastSearch(run)?.passages ?? []).map((p) => ({ title: p.title, page: p.page, score: p.score })),
        toolCalls: run.toolCalls.map((call) => call.name),
        pass: evaluation.pass,
        needsReview: evaluation.needsReview,
        checks: evaluation.checks,
      })),
    },
    null,
    2,
  ),
);

console.log('\n── Resumen ─────────────────────────────');
const counts = countByCategory(set.questions);
for (const category of CATEGORIES) {
  const inCategory = rows.filter((row) => row.question.category === category);
  const passed = inCategory.filter((row) => row.evaluation.pass).length;
  const pend = pending.filter((q) => q.category === category).length;
  console.log(
    `${category.padEnd(12)} ${passed}/${inCategory.length} sin fallas automáticas` +
      `  · cargadas ${counts[category]}/${TARGET_COUNTS[category]}` +
      (pend ? ` · pendientes de Fab Lab: ${pend}` : ''),
  );
}
for (const row of failed) {
  console.log(`\n✗ ${row.question.id}: ${row.question.question}`);
  for (const check of row.evaluation.checks.filter((c) => !c.ok)) console.log(`   - ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
}
console.log(`\nResultados: ${outFile}`);
const review = rows.filter((row) => row.evaluation.needsReview).length;
if (review) console.log(`${review} respuesta(s) requieren revisión de una persona de Fab Lab (fidelidad al documento y fuente citada).`);

process.exit(failed.length > 0 ? 1 : 0);
