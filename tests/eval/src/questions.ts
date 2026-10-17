import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Las cuatro categorías del conjunto de evaluación (spec §14). */
export const CATEGORIES = ['coverage', 'no-coverage', 'off-topic', 'scheduling'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Cuántas preguntas debe tener cada categoría para dar por completo el conjunto. */
export const TARGET_COUNTS: Record<Category, number> = {
  coverage: 15,
  'no-coverage': 8,
  'off-topic': 4,
  scheduling: 3,
};

const questionSchema = z.object({
  id: z.string().min(1),
  category: z.enum(CATEGORIES),
  question: z.string().min(1),
  /** Título (o parte) del documento que debería citarse; solo en `coverage`. */
  expectedDocument: z.string().optional(),
  /** Frases que la respuesta debe contener (datos que están en el documento). */
  mustInclude: z.array(z.string()).default([]),
  /** Frases que la respuesta no debe contener (datos inventados o ajenos a Fab Lab). */
  mustNotInclude: z.array(z.string()).default([]),
  /** Pregunta por completar con Fab Lab: se cuenta como pendiente y no se ejecuta. */
  pending: z.string().optional(),
});

export const questionSetSchema = z.object({
  /** El conjunto semilla es provisional: lo reemplazan las preguntas armadas con Fab Lab. */
  provisional: z.boolean(),
  questions: z.array(questionSchema).min(1),
});

export type Question = z.infer<typeof questionSchema>;
export type QuestionSet = z.infer<typeof questionSetSchema>;

export function parseQuestionSet(raw: unknown): QuestionSet {
  const set = questionSetSchema.parse(raw);
  const ids = set.questions.map((q) => q.id);
  const duplicated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicated) throw new Error(`Id de pregunta repetido: ${duplicated}`);
  return set;
}

export function loadQuestionSet(file = path.join(import.meta.dirname, '..', 'questions.json')): QuestionSet {
  return parseQuestionSet(JSON.parse(readFileSync(file, 'utf8')));
}

export function countByCategory(questions: Question[]): Record<Category, number> {
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<Category, number>;
  for (const question of questions) counts[question.category] += 1;
  return counts;
}
