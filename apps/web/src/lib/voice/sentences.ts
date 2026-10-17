/** Conserva las etiquetas de enlaces; nunca lee código, URLs ni sintaxis de Markdown. */
export function cleanSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, ' ')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[*_~`|]/g, '')
    .replace(/\s+/g, ' ').trim();
}

const ABBREVIATION = /(?:\b(?:sr|sra|srta|dr|dra|prof|aprox|etc|pág|núm|av|ud|uds)|\b[a-záéíóú])\.$/i;

/** Usa posiciones del texto original, para que limpiar un enlace incompleto no repita palabras. */
export class SentenceBuffer {
  private consumed = 0;

  take(text: string, final = false): string[] {
    const result: string[] = [];
    let start = this.consumed;
    let fence: string | null = null;
    let inline = false;
    let bracket = 0;
    let paren = 0;
    for (let i = start; i < text.length; i++) {
      const triple = text.slice(i, i + 3);
      if (triple === '```' || triple === '~~~') {
        if (!fence) fence = triple;
        else if (fence === triple) fence = null;
        i += 2; continue;
      }
      if (fence) continue;
      if (text[i] === '`') { inline = !inline; continue; }
      if (inline) continue;
      if (text[i] === '[') bracket++;
      if (text[i] === ']') bracket = Math.max(0, bracket - 1);
      if (text[i] === '(') paren++;
      if (text[i] === ')') paren = Math.max(0, paren - 1);
      if (bracket || paren) continue;
      const char = text[i]!;
      const fragment = text.slice(start, i + 1);
      const boundary = char === '\n' || /[.!?]/.test(char);
      // Espera el carácter siguiente: un punto al final de un delta puede ser un decimal.
      if (!boundary || (i + 1 === text.length && !final)) continue;
      if (char === '.' && (/\d\.$/.test(fragment) && /\d/.test(text[i + 1] ?? '') || ABBREVIATION.test(fragment))) continue;
      if (char !== '\n' && i + 1 < text.length && !/\s/.test(text[i + 1]!)) continue;
      const clean = cleanSpeechText(fragment);
      if (clean.length < 24 && !final && fragment.length < 500) continue;
      result.push(...splitSpeech(clean));
      this.consumed = start = i + 1;
    }
    if (final) {
      result.push(...splitSpeech(cleanSpeechText(text.slice(this.consumed))));
      this.consumed = text.length;
    } else if (text.length - this.consumed >= 500 && !fence && !bracket && !paren && !inline) {
      // Una oración muy larga también tiene que empezar a sonar antes de terminar el stream.
      const end = text.lastIndexOf(' ', this.consumed + 450);
      if (end > this.consumed) {
        result.push(...splitSpeech(cleanSpeechText(text.slice(this.consumed, end))));
        this.consumed = end + 1;
      }
    }
    return result.filter(Boolean);
  }
}

function splitSpeech(text: string): string[] {
  const chunks: string[] = [];
  while (text.length > 500) {
    const space = text.lastIndexOf(' ', 500);
    const end = space > 0 ? space : 500;
    chunks.push(text.slice(0, end));
    text = text.slice(end).trim();
  }
  if (text) chunks.push(text);
  return chunks;
}
