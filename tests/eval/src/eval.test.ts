import { describe, expect, it } from 'vitest';
import { evaluate, lastSearch, mentionsDocument, type AgentRun } from './checks';
import { CATEGORIES, countByCategory, loadQuestionSet, parseQuestionSet, TARGET_COUNTS, type Question } from './questions';

const question = (overrides: Partial<Question>): Question => ({
  id: 'q',
  category: 'coverage',
  question: '¿Qué servicios ofrece?',
  mustInclude: [],
  mustNotInclude: [],
  ...overrides,
});

const search = (found: boolean, titles: string[] = []) => ({
  name: 'searchDocuments',
  result: { found, passages: titles.map((title) => ({ title, page: 1, score: 0.9, text: 'x' })) },
});
const contact = { name: 'getContactInfo', result: { channels: [{ label: 'Correo' }] } };

describe('conjunto de preguntas', () => {
  it('questions.json es válido y tiene la composición del spec (15, 8, 4 y 3)', () => {
    const set = loadQuestionSet();
    expect(countByCategory(set.questions)).toEqual(TARGET_COUNTS);
    expect(set.provisional).toBe(true);
    expect(CATEGORIES.map((c) => TARGET_COUNTS[c])).toEqual([15, 8, 4, 3]);
  });

  it('rechaza ids repetidos y preguntas mal formadas', () => {
    expect(() => parseQuestionSet({ provisional: true, questions: [{ id: 'a', category: 'coverage', question: 'x' }, { id: 'a', category: 'coverage', question: 'y' }] })).toThrow(/repetido/);
    expect(() => parseQuestionSet({ provisional: true, questions: [{ id: 'a', category: 'otra', question: 'x' }] })).toThrow();
    expect(() => parseQuestionSet({ provisional: true, questions: [] })).toThrow();
  });
});

describe('lastSearch', () => {
  it('toma la última búsqueda del turno', () => {
    const run: AgentRun = { answer: '', toolCalls: [search(false), contact, search(true, ['Guía'])] };
    expect(lastSearch(run)).toMatchObject({ found: true, passages: [{ title: 'Guía' }] });
  });

  it('es null sin búsquedas o con un resultado inválido', () => {
    expect(lastSearch({ answer: '', toolCalls: [contact] })).toBeNull();
    expect(lastSearch({ answer: '', toolCalls: [{ name: 'searchDocuments', result: 'error' }] })).toBeNull();
  });
});

describe('mentionsDocument', () => {
  it('reconoce el título exacto y la mención parcial sin tildes ni mayúsculas', () => {
    expect(mentionsDocument('Según la Guía de Servicios, ofrecemos…', 'Guía de servicios')).toBe(true);
    expect(mentionsDocument('Según la guia de servicios', 'Guía de servicios')).toBe(true);
    expect(mentionsDocument('De acuerdo con el reglamento de uso del taller', 'Reglamento de uso del laboratorio')).toBe(true);
  });

  it('no confunde documentos distintos', () => {
    expect(mentionsDocument('Según la guía de servicios', 'Reglamento de seguridad')).toBe(false);
    expect(mentionsDocument('Hola', 'Fab Lab')).toBe(false);
  });
});

describe('evaluate: cobertura', () => {
  const ok: AgentRun = {
    answer: 'Según la guía de servicios, Fab Lab ofrece impresión 3D y corte láser.',
    toolCalls: [search(true, ['Guía de servicios'])],
  };

  it('pasa cuando busca, encuentra respaldo y nombra el documento', () => {
    const result = evaluate(question({ expectedDocument: 'Guía de servicios', mustInclude: ['impresión 3D'] }), ok);
    expect(result.pass).toBe(true);
    expect(result.needsReview).toBe(true); // la fidelidad la juzga una persona
  });

  it('falla si dice que no tiene la información pese a encontrar respaldo', () => {
    const result = evaluate(question({}), { ...ok, answer: 'No cuento con esa información.' });
    expect(result.pass).toBe(false);
    expect(result.checks.find((c) => c.name === 'no dice que no tiene la información')?.ok).toBe(false);
  });

  it('falla si no nombra el documento o nombra otro', () => {
    expect(evaluate(question({}), { ...ok, answer: 'Fab Lab ofrece impresión 3D.' }).pass).toBe(false);
    expect(evaluate(question({ expectedDocument: 'Reglamento' }), ok).pass).toBe(false);
  });

  it('falla si faltan datos esperados o aparecen datos ajenos', () => {
    const missing = evaluate(question({ mustInclude: ['soldadura'] }), ok);
    expect(missing.checks.find((c) => c.name === 'incluye los datos esperados')?.detail).toContain('soldadura');
    expect(evaluate(question({ mustNotInclude: ['impresión 3D'] }), ok).pass).toBe(false);
  });

  it('falla si respondió sin buscar', () => {
    expect(evaluate(question({}), { answer: 'Fab Lab es un laboratorio.', toolCalls: [] }).pass).toBe(false);
  });
});

describe('evaluate: sin cobertura', () => {
  const ok: AgentRun = {
    answer: 'No cuento con esa información en la documentación. Puedes escribir al correo del equipo.',
    toolCalls: [search(false), contact],
  };

  it('pasa cuando dice que no sabe y entrega el contacto', () => {
    const result = evaluate(question({ category: 'no-coverage' }), ok);
    expect(result.pass).toBe(true);
    expect(result.needsReview).toBe(false);
  });

  it('falla si inventa un dato (aparece lo prohibido)', () => {
    const result = evaluate(question({ category: 'no-coverage', mustNotInclude: ['$'] }), {
      ...ok,
      answer: 'El arriendo cuesta $5.000 por hora.',
    });
    expect(result.pass).toBe(false);
  });

  it('falla si no ofrece los canales de contacto', () => {
    expect(evaluate(question({ category: 'no-coverage' }), { ...ok, toolCalls: [search(false)] }).pass).toBe(false);
  });

  it('falla si la búsqueda sí encontró respaldo (la pregunta no era sin cobertura)', () => {
    expect(evaluate(question({ category: 'no-coverage' }), { ...ok, toolCalls: [search(true, ['Guía']), contact] }).pass).toBe(false);
  });
});

describe('evaluate: búsqueda caída', () => {
  it('una falla técnica de la búsqueda se informa como tal en cualquier categoría', () => {
    const run: AgentRun = {
      answer: 'Tuve un problema técnico al consultar la documentación.',
      toolCalls: [{ name: 'searchDocuments', result: { found: false, passages: [], unavailable: true } }, contact],
    };
    for (const category of ['coverage', 'no-coverage'] as const) {
      const result = evaluate(question({ category }), run);
      expect(result.pass).toBe(false);
      expect(result.checks.some((c) => c.name.includes('falló por un problema técnico') && !c.ok)).toBe(true);
    }
    expect(lastSearch(run)).toBeNull();
  });
});

describe('evaluate: agendar y fuera de tema', () => {
  it('agendar: consulta los horarios reales y no reserva ni afirma haber reservado', () => {
    const slots: AgentRun['toolCalls'][number] = { name: 'getAvailableSlots', result: { days: [] } };
    const run: AgentRun = {
      answer: 'Tengo estos horarios libres. ¿Cuál te acomoda? Necesito tu nombre, correo y el motivo.',
      toolCalls: [slots],
    };
    expect(evaluate(question({ category: 'scheduling' }), run).pass).toBe(true);
    expect(evaluate(question({ category: 'scheduling' }), { ...run, answer: 'Listo, te agendé para el martes.' }).pass).toBe(false);
    expect(evaluate(question({ category: 'scheduling' }), { ...run, answer: 'La reunión quedó agendada.' }).pass).toBe(false);
    expect(evaluate(question({ category: 'scheduling' }), { ...run, toolCalls: [] }).pass).toBe(false);
    expect(
      evaluate(question({ category: 'scheduling' }), { ...run, toolCalls: [slots, { name: 'scheduleMeeting', result: { status: 'needs_info' } }] }).pass,
    ).toBe(false);
  });

  it('fuera de tema: recuerda de qué puede ayudar y requiere revisión', () => {
    const run: AgentRun = { answer: 'Eso no tiene relación con Fab Lab; puedo ayudarte con sus servicios.', toolCalls: [] };
    const result = evaluate(question({ category: 'off-topic' }), run);
    expect(result.pass).toBe(true);
    expect(result.needsReview).toBe(true);
    expect(evaluate(question({ category: 'off-topic' }), { answer: 'El ganador fue Argentina.', toolCalls: [] }).pass).toBe(false);
  });
});
