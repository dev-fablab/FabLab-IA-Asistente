import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const DOCUMENTS_BUCKET = 'documents';

/** Vigencia de las URL firmadas de descarga (15 minutos, spec §4). */
export const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

let client: SupabaseClient | undefined;

/**
 * Cliente de Storage con la clave de servicio. Solo existe en el servidor:
 * el navegador nunca accede al bucket, solo sube con una URL firmada.
 */
function storageClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no están definidas');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

function bucket() {
  return storageClient().storage.from(DOCUMENTS_BUCKET);
}

export type SignedUpload = { path: string; token: string; signedUrl: string };

/** URL firmada para que el navegador suba un archivo directo al bucket. */
export async function createSignedUpload(path: string): Promise<SignedUpload> {
  const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new Error(`No se pudo crear la URL de subida: ${error?.message}`);
  return { path: data.path, token: data.token, signedUrl: data.signedUrl };
}

/** URL firmada de descarga de corta duración; no existe ninguna URL pública permanente. */
export async function createSignedDownloadUrl(
  path: string,
  options: { downloadName?: string } = {},
): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(path, DOWNLOAD_URL_TTL_SECONDS, {
    download: options.downloadName ?? false,
  });
  if (error || !data) throw new Error(`No se pudo firmar la descarga: ${error?.message}`);
  return data.signedUrl;
}

/** Descarga el objeto completo para extraer su texto en la ingesta. */
export async function downloadObject(path: string): Promise<Uint8Array> {
  const { data, error } = await bucket().download(path);
  if (error || !data) throw new Error(`No se pudo leer el archivo: ${error?.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Rutas completas de los objetos de una carpeta (`{document_id}/`). */
export async function listFolder(folder: string): Promise<string[]> {
  const { data, error } = await bucket().list(folder, { limit: 1000 });
  if (error) throw new Error(`No se pudo listar la carpeta: ${error.message}`);
  return (data ?? []).filter((o) => o.id !== null).map((o) => `${folder}/${o.name}`);
}

export async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await bucket().remove(paths);
  if (error) throw new Error(`No se pudo borrar el archivo: ${error.message}`);
}
