import { describe, expect, it } from 'vitest';
import { liveMood, MOOD_ANIMATION, MOOD_EXPRESSION, outcomeMood, statusLabel, turnOf, type MessageLike } from './mood';
import strobi from './strobi.avatar.json';

const text = (value: string) => ({ type: 'text', text: value });
const search = (result?: unknown) => ({ type: 'tool-call', toolName: 'searchDocuments', result });
const assistant = (content: MessageLike['content'], status: MessageLike['status'] = { type: 'complete' }): MessageLike => ({ role: 'assistant', status, content });

describe('turnOf', () => {
  it('sin mensajes no hay turno, y una pregunta sin respuesta solo «espera» si el runtime corre', () => {
    expect(turnOf(undefined, false)).toBe('none');
    expect(turnOf({ role: 'user', content: [text('hola')] }, true)).toBe('waiting');
    expect(turnOf({ role: 'user', content: [text('hola')] }, false)).toBe('none');
  });

  it('distingue esperar, buscar y escribir mientras la respuesta corre', () => {
    const running = { type: 'running' };
    expect(turnOf(assistant([], running), true)).toBe('waiting');
    expect(turnOf(assistant([search()], running), true)).toBe('searching');
    expect(turnOf(assistant([search({ found: true }), text('Según')], running), true)).toBe('writing');
  });

  it('al terminar: respondió, no había información, la búsqueda falló o hubo un error', () => {
    expect(turnOf(assistant([search({ found: true }), text('Listo')]), false)).toBe('answered');
    expect(turnOf(assistant([search({ found: false, passages: [] }), text('No tengo ese dato')]), false)).toBe('no-info');
    expect(turnOf(assistant([search({ found: false, unavailable: true }), text('Falló')]), false)).toBe('unavailable');
    expect(turnOf(assistant([], { type: 'incomplete', reason: 'error' }), false)).toBe('failed');
    // Un saludo sin búsqueda es una respuesta normal, no un vacío.
    expect(turnOf(assistant([text('¡Hola!')]), false)).toBe('answered');
  });

  it('si la persona detiene la respuesta sin texto no hay turno', () => {
    expect(turnOf(assistant([], { type: 'incomplete', reason: 'cancelled' }), false)).toBe('none');
  });
});

describe('statusLabel', () => {
  const tool = (toolName: string, result?: unknown) => ({ type: 'tool-call', toolName, result });
  const running = { type: 'running' };

  it('sin herramienta en curso dice «Escribiendo…», también antes de que llegue texto', () => {
    expect(statusLabel(undefined)).toBe('Escribiendo…');
    expect(statusLabel(assistant([], running))).toBe('Escribiendo…');
    expect(statusLabel(assistant([text('Según la guía')], running))).toBe('Escribiendo…');
  });

  it('nombra la herramienta que está corriendo', () => {
    expect(statusLabel(assistant([tool('searchDocuments')], running))).toBe('Revisando la documentación…');
    expect(statusLabel(assistant([tool('getDocumentLink')], running))).toBe('Buscando el documento…');
    expect(statusLabel(assistant([tool('getContactInfo')], running))).toBe('Consultando los canales de contacto…');
    expect(statusLabel(assistant([tool('otraHerramienta')], running))).toBe('Consultando…');
  });

  it('una herramienta que ya terminó no cuenta: vuelve a «Escribiendo…»', () => {
    expect(statusLabel(assistant([tool('searchDocuments', { found: true }), text('Según')], running))).toBe('Escribiendo…');
  });
});

describe('liveMood y outcomeMood', () => {
  it('sigue las etapas del turno y, en reposo, si la persona está escribiendo', () => {
    expect(liveMood('waiting', false)).toBe('thinking');
    expect(liveMood('searching', true)).toBe('searching');
    expect(liveMood('writing', false)).toBe('working');
    expect(liveMood('answered', true)).toBe('listening');
    expect(liveMood('none', false)).toBe('idle');
  });

  it('reacciona cuando el turno pasa a un resultado', () => {
    expect(outcomeMood('writing', 'answered')).toBe('happy');
    expect(outcomeMood('searching', 'no-info')).toBe('confused');
    expect(outcomeMood('waiting', 'failed')).toBe('sad');
    expect(outcomeMood('writing', 'unavailable')).toBe('sad');
    // Un error inmediato puede llegar sin que se haya renderizado la espera.
    expect(outcomeMood('none', 'failed')).toBe('sad');
  });

  it('no reacciona si el turno no cambia, sigue en curso o la persona lo detuvo', () => {
    expect(outcomeMood('answered', 'answered')).toBeNull();
    expect(outcomeMood('waiting', 'writing')).toBeNull();
    expect(outcomeMood('writing', 'none')).toBeNull();
  });
});

describe('definición de Strobi', () => {
  it('cada ánimo apunta a una animación y a una expresión que existen', () => {
    for (const animation of Object.values(MOOD_ANIMATION)) expect(strobi.animations).toHaveProperty(animation);
    for (const expression of Object.values(MOOD_EXPRESSION)) expect(strobi.expressions).toHaveProperty(expression);
  });

  it('el orden declarado coincide con las expresiones y animaciones definidas', () => {
    expect([...strobi.expressionOrder].sort()).toEqual(Object.keys(strobi.expressions).sort());
    expect([...strobi.animationOrder].sort()).toEqual(Object.keys(strobi.animations).sort());
    expect(Object.keys(strobi.expressions)).toHaveLength(28);
    expect(Object.keys(strobi.animations)).toHaveLength(23);
  });
});
