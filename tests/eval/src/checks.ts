import type { Question } from './questions';

export type ToolCall = { name: string; result: unknown };

/** Lo que hizo el agente ante una pregunta: su respuesta y las herramientas que llamó, en orden. */
export type AgentRun = { answer: string; toolCalls: ToolCall[] };

export type Passage = { title: string; page: number | null; score: number; text: string };

export type Check = { name: string; ok: boolean; detail?: string };

export type Evaluation = {
  /** Todas las comprobaciones automáticas pasaron. */
  pass: boolean;
  checks: Check[];
  /** Hay aspectos que solo una persona de Fab Lab puede juzgar (fidelidad al documento, tono). */
  needsReview: boolean;
};

const NO_INFO = /\bno (cuento|tengo|dispongo|encuentro|puedo (confirmar|asegurar))\b|\bno hay (información|datos)\b|no (est[aá]|aparece|figura) en (la|los) (documentaci[oó]n|documentos)/i;
/** Da por hecha la reserva: en un turno sin datos ni confirmación, eso es una invención. */
const CLAIMS_BOOKED = /\b(te|lo|la) (he )?agend[eé](?!\p{L})|qued[oó] agendad[ao]|reserva (confirmada|lista)|ya (est[aá]|qued[oó]) (agendad|reservad)/iu;
const STOP_WORDS = new Set(['para', 'como', 'sobre', 'entre', 'desde', 'hasta', 'este', 'esta', 'estos', 'estas', 'fablab', 'fab']);

const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

/** La búsqueda falló por un problema técnico (`unavailable`): el resultado no sirve para evaluar. */
export const searchWasUnavailable = (run: AgentRun): boolean =>
  run.toolCalls.some(
    (call) => call.name === 'searchDocuments' && (call.result as { unavailable?: unknown } | undefined)?.unavailable === true,
  );

/** Resultado de la última llamada a `searchDocuments` del turno (la que decide `no_answer`). */
export function lastSearch(run: AgentRun): { found: boolean; passages: Passage[] } | null {
  const calls = run.toolCalls.filter((call) => call.name === 'searchDocuments');
  const result = calls.at(-1)?.result as { found?: unknown; passages?: unknown; unavailable?: unknown } | undefined;
  if (!result || typeof result.found !== 'boolean' || result.unavailable === true) return null;
  return { found: result.found, passages: Array.isArray(result.passages) ? (result.passages as Passage[]) : [] };
}

const called = (run: AgentRun, tool: string) => run.toolCalls.some((call) => call.name === tool);

/** La respuesta nombra el documento aunque no repita su título exacto («según la guía de servicios»). */
export function mentionsDocument(answer: string, title: string): boolean {
  const haystack = normalize(answer);
  if (haystack.includes(normalize(title))) return true;
  const words = normalize(title)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
  if (words.length === 0) return false;
  return words.filter((word) => haystack.includes(word)).length / words.length >= 0.5;
}

const includesAll = (answer: string, phrases: string[]): string[] =>
  phrases.filter((phrase) => !normalize(answer).includes(normalize(phrase)));

/**
 * Comprobaciones automáticas por categoría. No reemplazan la revisión de una persona de Fab Lab
 * (criterios 2 y 3: «correcta y consistente con el documento», «nombra el documento correcto»):
 * miden lo que se puede medir y marcan lo demás para revisión.
 */
export function evaluate(question: Question, run: AgentRun): Evaluation {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(detail && { detail }) });
  const search = lastSearch(run);
  const answer = run.answer;

  // Una falla técnica (modelo de embeddings, base de datos) no es una respuesta del asistente: se
  // reporta aparte para no confundirla con «no encontró documentación».
  if (searchWasUnavailable(run)) add('la búsqueda estuvo disponible (falló por un problema técnico)', false);

  const missing = includesAll(answer, question.mustInclude);
  if (question.mustInclude.length > 0) add('incluye los datos esperados', missing.length === 0, missing.length ? `faltan: ${missing.join(', ')}` : undefined);

  const forbidden = question.mustNotInclude.filter((phrase) => normalize(answer).includes(normalize(phrase)));
  if (question.mustNotInclude.length > 0) add('no incluye datos ajenos', forbidden.length === 0, forbidden.length ? `aparece: ${forbidden.join(', ')}` : undefined);

  switch (question.category) {
    case 'coverage': {
      add('buscó en la documentación', search !== null);
      add('encontró respaldo', search?.found === true);
      add('no dice que no tiene la información', !NO_INFO.test(answer));
      const titles = [...new Set((search?.passages ?? []).map((p) => p.title))];
      const named = titles.filter((title) => mentionsDocument(answer, title));
      add('nombra un documento recuperado', named.length > 0, titles.length ? `recuperados: ${titles.join(' | ')}` : 'no se recuperó ninguno');
      if (question.expectedDocument) {
        const expected = question.expectedDocument;
        add(
          `nombra el documento esperado («${expected}»)`,
          titles.some((title) => normalize(title).includes(normalize(expected))) && mentionsDocument(answer, expected),
        );
      }
      break;
    }
    case 'no-coverage': {
      add('buscó en la documentación', search !== null);
      add('la búsqueda no encontró respaldo', search?.found === false);
      add('dice que no tiene la información', NO_INFO.test(answer));
      add('ofrece los canales de contacto', called(run, 'getContactInfo'));
      break;
    }
    case 'scheduling': {
      // Un turno solo trae la intención de agendar: faltan los datos y la confirmación, así que no se reserva.
      add('consulta los horarios reales con getAvailableSlots', called(run, 'getAvailableSlots'));
      add('no agenda sin datos ni confirmación', !called(run, 'scheduleMeeting'));
      add('no afirma que la reunión quedó agendada', !CLAIMS_BOOKED.test(answer));
      break;
    }
    case 'off-topic': {
      // Regla 10: indicar con amabilidad que no es su tema y recordar de qué sí puede ayudar.
      add('recuerda de qué temas puede ayudar', /fab\s?lab/i.test(answer));
      add('no entrega documentos ni datos de contacto sin que se pidan', !called(run, 'getDocumentLink'));
      break;
    }
  }

  return {
    pass: checks.every((check) => check.ok),
    checks,
    // Fidelidad al documento y tono: solo una persona lo juzga.
    needsReview: question.category === 'coverage' || question.category === 'off-topic',
  };
}
