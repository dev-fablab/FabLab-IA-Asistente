-- Cambio del modelo de embeddings (OpenRouter 1536 dimensiones → NVIDIA NIM `baai/bge-m3`, 1024).
-- Un vector de otra dimensión no se puede convertir, y mezclar modelos en la misma búsqueda daría
-- resultados sin sentido: se descartan los fragmentos y los documentos quedan pendientes de reindexar.
TRUNCATE TABLE "document_chunks";--> statement-breakpoint

-- El panel ofrece «Reintentar» en los documentos `failed`; con eso se reindexan con el modelo nuevo.
UPDATE "documents"
SET "status" = 'failed',
    "error_message" = 'Cambió el modelo de embeddings: reintenta para reindexar este documento',
    "chunk_count" = 0,
    "updated_at" = now()
WHERE "status" IN ('ready', 'processing');--> statement-breakpoint

-- El índice HNSW se reconstruye solo al cambiar el tipo de la columna (la tabla ya está vacía).
ALTER TABLE "document_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);
