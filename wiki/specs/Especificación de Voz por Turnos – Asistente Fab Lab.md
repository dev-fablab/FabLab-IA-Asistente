# Especificación de Voz por Turnos – Asistente Fab Lab

Oct 17, 2026 · @Diego Cancino

## 1. Resumen y alcance

La voz por turnos manos libres permite conversar con el asistente de Fab Lab hablando en lugar de escribir, sin infraestructura nueva: el navegador detecta cuándo la persona habla y cuándo termina, y cada turno recorre tres rutas de la API Hono que ya vive dentro de Next.js (`/voice/transcribe`, `/chat` y `/voice/speech`). Si la persona vuelve a hablar mientras suena la respuesta, el navegador la interrumpe y empieza un turno nuevo.

Es el peldaño 2 de la proyección de voz de la [especificación de la Fase 1](https://claude.ai/code/artifact/9eed8402-a75b-45bf-be62-c52b0de630b7) (sección 16), con detección de voz automática en lugar de un botón de mantener pulsado. El agente, sus herramientas, el RAG, la política de veracidad y el historial son los mismos de la Fase 1; el audio solo entra y sale por los bordes.

**Dentro del alcance**

- Captura del micrófono en el navegador y detección automática de inicio y fin de voz.
- Transcripción de cada turno con el modelo de STT de OpenRouter.
- Respuesta del agente por `/chat`, con instrucciones adaptadas al canal de voz.
- Respuesta hablada con el modelo de TTS de OpenRouter, pedida por oraciones.
- Interrupción de la respuesta cuando la persona vuelve a hablar, con cancelación de lo que está en curso.
- Guardado de cada turno en el historial (`conversations` y `messages`) con canal y modalidad de voz.

**Fuera del alcance**

- Conversación en tiempo real con audio continuo en ambos sentidos (LiveKit o un proveedor de voz a voz), definida como Fase 3 en la especificación de la Fase 1.
- Llamadas telefónicas.
- Guardar el audio de las personas: solo se conserva la transcripción.
- Reconocimiento de quién habla.
- Cambio automático de idioma: el idioma principal es el español.

## 2. Requerimientos

Los requerimientos funcionales definen qué puede hacer la persona; los no funcionales fijan metas que se validan con un prototipo antes de comprometerlas, porque dependen de los proveedores de STT y TTS y del dispositivo.

| ID | Requerimiento | Prioridad |
| --- | --- | --- |
| RV-01 | Activar y desactivar el modo de voz con un botón en el chat; el micrófono solo se abre con el modo activo y con el permiso del navegador | Debe |
| RV-02 | Detectar automáticamente el inicio y el fin de la voz en el navegador, sin pulsar nada | Debe |
| RV-03 | Transcribir cada turno y mostrarlo en el hilo como mensaje de la persona | Debe |
| RV-04 | Responder con el mismo agente y la misma política de veracidad que el chat de texto | Debe |
| RV-05 | Reproducir la respuesta en voz, por oraciones, mientras el texto sigue llegando; el texto también se muestra en pantalla | Debe |
| RV-06 | Interrumpir: si la persona habla mientras suena la respuesta, cortar el audio, cancelar la generación y la síntesis pendientes y empezar el turno siguiente | Debe |
| RV-07 | Mostrar el estado en pantalla: escuchando, grabando, transcribiendo, pensando o hablando | Debe |
| RV-08 | Mostrar en pantalla las tarjetas de documento y de contacto y avisar de ellas en voz | Debe |
| RV-09 | Manejar errores (permiso denegado, sin micrófono, STT o TTS caídos, límite de tasa) con mensajes claros y volver a un estado utilizable; el chat de texto sigue disponible | Debe |
| RV-10 | Guardar cada turno en el historial con canal `voice` y modalidad `voice`, sin guardar el audio | Debe |
| RV-11 | Evitar falsas interrupciones con una duración mínima de voz y cancelación de eco | Debe |
| RV-12 | Tras una interrupción, recordar solo lo que se alcanzó a escuchar de la respuesta cortada | Debería |
| RV-13 | Elegir la voz y la velocidad de la respuesta | Podría |
| RV-14 | Usar la voz en una sola dirección: solo dictado o solo respuesta hablada | Podría |

| Categoría | Requisito | Meta inicial |
| --- | --- | --- |
| Latencia | Del fin de la frase al primer sonido de la respuesta | Menos de 4 s (percentil 95), a validar con el prototipo |
| Interrupción | Del inicio de la voz de la persona al corte del audio | Menos de 300 ms |
| Falsas interrupciones | Turnos cortados sin que nadie haya hablado | Menos del 5 % en el entorno de prueba, a validar |
| Duración del turno | Voz mínima para contar como turno y grabación máxima | 400 ms y 60 s |
| Compatibilidad | Navegadores | Chrome y Edge de escritorio, Chrome en Android y Safari en iOS |
| Accesibilidad | El texto siempre está disponible y la voz nunca es obligatoria | Controles con teclado, transcripción siempre visible |
| Privacidad | Qué se guarda | Solo la transcripción; el audio no se almacena |
| Idioma | Reconocimiento y síntesis | Español de Chile como idioma principal |

## 3. Arquitectura

El audio nunca llega al agente: el navegador lo convierte en texto con `/voice/transcribe`, el texto viaja por `/chat` como cualquier mensaje y la respuesta vuelve a convertirse en audio con `/voice/speech`. Las tres rutas viven en la API Hono que ya corre dentro de Next.js, con el mismo origen, la misma autenticación (el chat es público) y el mismo límite de tasa; el estado del turno vive solo en el navegador.

&#91;embedded content: arquitectura de la voz por turnos · navegador, tres rutas Hono y OpenRouter\]

**Decisiones de diseño**

1. **Frases completas, no audio en streaming.** El detector de voz entrega cada frase ya terminada. El navegador la codifica como WAV de 16 kHz, mono y 16 bits (unos 32 KB por segundo: 60 s son cerca de 1,9 MB), que cabe en el límite de 4,5 MB del cuerpo de una función de Vercel y evita las diferencias de formato de `MediaRecorder` entre navegadores. El STT de OpenRouter trabaja por archivo, así que no ganaría nada con audio en streaming.
2. **`/chat` no cambia de contrato.** Solo se agrega el canal `voice`, que selecciona las instrucciones de voz del agente, y la modalidad del mensaje en el historial.
3. **Síntesis por oraciones.** El cliente parte el texto que llega en streaming en oraciones y pide cada una a `/voice/speech`; la primera suena antes de que termine la respuesta.
4. **Cancelación de punta a punta.** Interrumpir cancela con `AbortController` la petición a `/chat` y las de síntesis pendientes, y descarta el audio en cola.
5. **La voz de Mastra detrás de una interfaz.** El `CompositeVoice` de Mastra acepta modelos del AI SDK; se apuntan a los endpoints de STT y TTS de OpenRouter. Cambiar de modelo o de proveedor es cambiar variables de entorno.
6. **Servidor sin estado.** Cada petición es independiente; el hilo viene del cliente, igual que en el chat de texto.

## 4. Estados del turno y reglas de interrupción

El controlador de turnos vive en el navegador y es una máquina de estados con un solo turno en curso. Cada turno lleva un identificador creciente (`turnId`); todo lo que llegue de un turno ya cancelado se descarta, y así una respuesta tardía nunca pisa a la siguiente.

&#91;embedded content: estados del turno de voz en el navegador · la interrupción vuelve a Grabando\]

| Evento | Qué hace el controlador |
| --- | --- |
| Activar la voz | Pide el permiso del micrófono, carga el modelo del detector de voz y pasa a Escuchando |
| Inicio de voz detectado | En Escuchando, pasa a Grabando. En Pensando o Hablando, **pausa** el audio sin cancelar nada y espera la confirmación |
| Voz muy corta (`onVADMisfire`) | Descarta el fragmento; si había pausado el audio, lo reanuda; vuelve al estado anterior |
| Voz confirmada (400 ms o más) durante una respuesta | **Interrumpe**: detiene el audio, cancela con `AbortController` la petición a `/chat` y las de `/voice/speech` pendientes, vacía la cola de oraciones, marca el mensaje del asistente como interrumpido y pasa a Grabando |
| Fin de voz (`onSpeechEnd`) | Codifica la frase como WAV, la envía a `/voice/transcribe` y pasa a Transcribiendo |
| Texto recibido | Si viene vacío, vuelve a Escuchando; si no, lo agrega al hilo como mensaje de la persona, llama a `/chat` con el canal `voice` y pasa a Pensando |
| Texto del agente en streaming | Lo parte en oraciones y pide el audio de cada una a `/voice/speech` |
| Primer audio listo | Empieza a reproducir y pasa a Hablando |
| Fin del stream y de la cola de audio | Vuelve a Escuchando |
| Error de STT, de TTS o de red | Muestra un mensaje claro y vuelve a Escuchando; si el micrófono se pierde, pasa a Inactivo |
| Desactivar la voz | Cancela todo, destruye el detector, libera el micrófono y pasa a Inactivo |

**Reglas de la interrupción**

- **Pausar antes de cancelar.** Una tos o un ruido breve no deberían costar la respuesta. Por eso el audio se pausa al detectar voz y solo se cancela si la voz dura al menos 400 ms. Si el detector instalado expone un evento de voz confirmada se usa ese; si no, un temporizador propio.
- **Eco.** El micrófono se abre con cancelación de eco y supresión de ruido activadas, y mientras suena la respuesta se sube el umbral del detector. Con audífonos casi no hay eco; con altavoces en una sala puede ser el principal problema (sección 9).
- **Un solo turno a la vez.** Si llega voz mientras se transcribe, la frase nueva se encola detrás de la actual; no se abren dos peticiones a `/chat` en paralelo.
- **Lo que se recuerda.** El mensaje interrumpido conserva solo el texto de las oraciones que alcanzaron a sonar (sección 7).

## 5. Contratos de las rutas

Las tres rutas cuelgan de `/api` y aquí se escriben sin ese prefijo. Las dos de voz son nuevas; `/chat` es la de la Fase 1 con un campo más.

| Ruta | Entrada | Salida | Límites |
| --- | --- | --- | --- |
| `POST /voice/transcribe` | `multipart/form-data` con `audio` (WAV 16 kHz, mono) | `{ "text": "..." }` | 60 s de audio y 3 MB; formatos `wav` y `mp3`; idioma `es` |
| `POST /chat` | `{ id, messages, channel: 'voice' }` | El mismo stream de mensajes de UI del chat de texto | Los de la Fase 1: 20 mensajes de hilo y 2.000 caracteres por mensaje |
| `POST /voice/speech` | `{ "text": "..." }` (una oración) | Audio `audio/mpeg` (mp3) | 500 caracteres por llamada; `cache-control: no-store` |

Las tres son públicas y pasan por el límite de tasa de la API; las dos de voz tienen un límite propio, más estricto, porque cuestan por segundo de audio y por carácter (sección 8).

**Errores.** Usan el formato de la API, `{ "error": { "code": "...", "message": "..." } }`, con estos códigos HTTP:

| Código | Cuándo |
| --- | --- |
| 400 | Cuerpo inválido, texto vacío o demasiado largo |
| 413 | La grabación supera el tamaño permitido |
| 415 | Formato de audio no admitido |
| 429 | Límite de tasa superado, con `Retry-After` |
| 502 | El proveedor de STT o de TTS falló o no respondió |

```ts
// packages/server/src/routes/voice.ts (ilustrativo)
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { zValidator } from '@hono/zod-validator';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { voice } from '@fablab/agent';
import { voiceRateLimit } from '../middleware/rate-limit';

export const voiceRoutes = new Hono()
  .post(
    '/voice/transcribe',
    voiceRateLimit,
    bodyLimit({
      maxSize: 3 * 1024 * 1024,
      onError: (c) => c.json({ error: { code: 'too_large', message: 'La grabación es demasiado larga' } }, 413),
    }),
    async (c) => {
      const audio = (await c.req.formData()).get('audio');
      if (!(audio instanceof File) || !['audio/wav', 'audio/x-wav', 'audio/mpeg'].includes(audio.type)) {
        return c.json({ error: { code: 'unsupported', message: 'Formato de audio no admitido' } }, 415);
      }
      const text = await voice.listen(Readable.fromWeb(audio.stream() as never), { language: 'es' });
      return c.json({ text: String(text).trim() });
    },
  )
  .post(
    '/voice/speech',
    voiceRateLimit,
    zValidator('json', z.object({ text: z.string().min(1).max(500) })),
    async (c) => {
      const audio = await voice.speak(c.req.valid('json').text, {
        speaker: process.env.TTS_VOICE,
        responseFormat: 'mp3',
      });
      return new Response(Readable.toWeb(audio as Readable) as ReadableStream, {
        headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
      });
    },
  );
```

```ts
// packages/agent/src/models.ts: la voz de Mastra con los modelos de OpenRouter
export const voice = new CompositeVoice({
  input: openrouter.transcription(process.env.STT_MODEL!),
  output: openrouter.speech(process.env.TTS_MODEL!),
});
```

```ts
// packages/server/src/routes/chat.ts: el único cambio respecto de la Fase 1
const body = z.object({
  id: z.string().uuid(),
  messages: z.array(z.any()).min(1),
  channel: z.enum(['web', 'voice']).default('web'), // selecciona las instrucciones del agente
});
// el canal llega al agente por el request context; el nombre exacto del parámetro
// en handleChatStream se confirma contra la versión instalada de @mastra/ai-sdk
```

Se confirman al implementar: el tipo de stream que acepta `voice.listen`, la conversión entre streams de Node y de la web, que el parámetro `language` llegue al proveedor de STT y que `TTS_VOICE` sea una voz válida del modelo elegido.

## 6. Cliente

El cliente es un módulo de la web (`apps/web/src/lib/voice/`) más un botón y un indicador de estado en el chat. No reemplaza el chat de texto: la persona puede escribir o hablar en la misma conversación, y si la voz falla el texto sigue funcionando.

| Módulo | Responsabilidad |
| --- | --- |
| `vad.ts` | Envuelve `MicVAD` de `@ricky0123/vad-web`, que corre el modelo Silero en el navegador y entrega `onSpeechStart`, `onSpeechEnd` (con la frase como `Float32Array` a 16 kHz) y `onVADMisfire` |
| `wav.ts` | Codifica la frase como WAV de 16 bits, mono |
| `sentences.ts` | Parte el texto en streaming en oraciones (punto, signos de interrogación y exclamación, saltos de línea), con un mínimo de caracteres para no pedir audios de dos palabras |
| `audio-queue.ts` | Cola de reproducción: encola, pausa, reanuda y cancela; pide el audio de la oración siguiente mientras suena la actual y recuerda qué texto alcanzó a sonar |
| `controller.ts` | La máquina de estados de la sección 4, el `turnId` y un `AbortController` por turno |
| `use-voice.ts` | Hook de React que expone el estado y las acciones (`start`, `stop`) a la interfaz |

**Parámetros iniciales del detector** (se ajustan en el entorno real; los nombres de las opciones se confirman contra la versión instalada)

| Parámetro | Valor inicial | Nota |
| --- | --- | --- |
| Voz mínima (`minSpeechMs`) | 400 ms | Por debajo es una falsa alarma (`onVADMisfire`) |
| Pausa para cerrar la frase (`redemptionMs`) | 800 ms | Más corto responde antes pero corta a quien hace pausas; más largo espera de más |
| Umbral de voz | 0,5 en reposo y 0,7 mientras suena la respuesta | El umbral más alto reduce las interrupciones por eco |
| Relleno previo | 300 ms | Evita cortar el comienzo de la frase |
| Micrófono | Cancelación de eco, supresión de ruido y control de ganancia activados | Restricciones de `getUserMedia` |

```ts
// apps/web/src/lib/voice/controller.ts (ilustrativo)
type State = 'idle' | 'listening' | 'recording' | 'transcribing' | 'thinking' | 'speaking';

let turn = 0;                 // identificador del turno vigente
let abort: AbortController | null = null;
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

const onSpeechStart = () => {
  if (state === 'thinking' || state === 'speaking') {
    player.pause();                              // pausar antes de cancelar
    confirmTimer = setTimeout(interrupt, 400);   // voz confirmada
  } else if (state === 'listening') {
    setState('recording');
  }
};

const onVADMisfire = () => {
  clearTimeout(confirmTimer);
  if (state === 'speaking') player.resume();     // era una tos o un ruido
};

const interrupt = () => {
  turn += 1;                                     // lo que llegue de turnos anteriores se descarta
  abort?.abort();                                // /chat y /voice/speech pendientes
  player.cancel();                               // detiene el audio y vacía la cola
  markAssistantInterrupted(player.playedText()); // se conserva solo lo que sonó
  setState('recording');
};

const onSpeechEnd = async (audio: Float32Array) => {
  clearTimeout(confirmTimer);
  const id = ++turn;
  abort = new AbortController();
  setState('transcribing');
  const text = await transcribe(encodeWav(audio, 16000), abort.signal); // POST /voice/transcribe
  if (id !== turn) return;                       // turno cancelado
  if (!text) return setState('listening');
  setState('thinking');
  await runAgentTurn(text, id, abort.signal);    // /chat en streaming, oraciones y /voice/speech
};
```

**Integración con Assistant UI.** El hilo es el de Assistant UI: el controlador agrega el mensaje de la persona con la API del runtime del hilo y lee el texto en streaming de la respuesta para partirlo en oraciones. El botón «Escuchar» de cada respuesta (peldaño 1) usa el `SpeechSynthesisAdapter` de Assistant UI, cuyo método `speak(texto)` devuelve una `Utterance` con `cancel` y `subscribe`, apuntado a `/voice/speech`. El modo manos libres vive fuera de los adaptadores de dictado, que están pensados para pulsar y hablar. Los nombres exactos de la API del runtime se confirman al implementar.

**Interfaz**

- Un botón de micrófono en la caja de texto activa y desactiva la voz; al activarlo, el clic desbloquea el audio del navegador (necesario en iOS) y pide el permiso.
- Un indicador muestra el estado (escuchando, grabando, transcribiendo, pensando, hablando) con texto, no solo con color, y se anuncia a los lectores de pantalla.
- La transcripción aparece en el hilo como cualquier mensaje y la respuesta se muestra mientras se lee en voz alta.
- Un botón detiene la respuesta que suena sin desactivar la voz.
- El detector y el modelo (del orden de 10 MB, a medir) se sirven desde nuestro dominio y se descargan la primera vez que se activa la voz.
- El micrófono exige HTTPS y el permiso del sitio; si se deniega o se revoca, el controlador pasa a Inactivo con un mensaje claro.

## 7. Agente e historial

El agente es el de la Fase 1, con las mismas herramientas y la misma política de veracidad. Para la voz cambia solo la forma de responder, y el historial no necesita tablas ni columnas nuevas.

**Instrucciones del canal de voz.** `buildInstructions('voice')` devuelve las reglas de fondo de la Fase 1 más estas reglas de forma:

1. Responde en frases cortas y naturales, de una a tres oraciones, y ofrece ampliar si hay más.
2. Nada de formato: sin listas, títulos, negritas, tablas, enlaces ni símbolos; si hay varios elementos, enumera con palabras («primero…, luego…»).
3. Di las cifras, horarios y siglas como se leen en voz alta; no deletrees direcciones web ni correos.
4. Cuando entregues un documento o un canal de contacto, dilo y avisa que lo dejas en pantalla.
5. Si la transcripción parece dudosa o falta contexto, confirma antes de responder; trata «Fab Lab» y «fablab» como lo mismo.
6. Mantén las reglas de fondo: responde solo con lo que dicen los documentos y, si no hay información, dilo y ofrece el contacto.
7. Haz una sola pregunta a la vez y no retomes lo anterior tras una interrupción, salvo que te lo pidan.

El modelo puede seguir escribiendo markdown a pesar de las instrucciones, por lo que el cliente limpia el texto antes de pedir el audio: quita marcas de formato, conserva el texto de los enlaces y descarta los bloques de código. Así la síntesis nunca lee símbolos, y las instrucciones reducen el problema en lugar de ser la única defensa.

**Herramientas.** No cambian. Los resultados de `getDocumentLink` y `getContactInfo` siguen mostrándose como tarjetas en pantalla; el agente no lee en voz alta las URL firmadas ni los datos largos, solo avisa que están en la pantalla.

**Historial.** Cada turno se guarda como en el chat de texto, a través de `POST /chat`:

| Qué | Cómo se guarda |
| --- | --- |
| Mensaje de la persona | La transcripción, con `modality = 'voice'`; el audio no se guarda |
| Mensaje del asistente | El texto de la respuesta, con la modalidad del mensaje que respondió |
| Conversación | `channel = 'voice'` desde que recibe su primer mensaje de voz, de modo que el panel puede filtrar las conversaciones con voz; una conversación puede mezclar texto y voz |
| «Sin información» | Igual que en texto: la marca sale de la búsqueda (`found: false`), no del contenido |

**Turnos interrumpidos.** Hay dos versiones de lo que dijo el asistente: lo que se generó y lo que la persona alcanzó a escuchar.

- **Para el modelo, lo escuchado.** El cliente envía en el hilo del turno siguiente el mensaje del asistente recortado al texto de las oraciones que sonaron, de modo que la conversación continúe desde donde la persona se quedó.
- **Para el panel, lo generado.** La API guarda el mensaje del asistente al terminar el stream. Al cancelarse la petición, ese guardado depende del callback que exponga la versión instalada de Mastra: si no se dispara al abortar, las respuestas interrumpidas no aparecerán en el historial. Se decide al implementar y, si hace falta, se acepta como limitación de la Fase 2 en lugar de agregar una columna para marcar interrupciones.

## 8. Seguridad, privacidad y costos

Las rutas de voz son públicas y cobran por segundo de audio y por carácter sintetizado, así que el abuso cuesta dinero. Los controles están en el servidor, porque los del navegador se pueden saltar.

| Límite | Valor inicial |
| --- | --- |
| `POST /voice/transcribe` | 12 cada 5 minutos y 80 por día, por IP |
| `POST /voice/speech` | 60 cada 5 minutos y 400 por día, por IP; una respuesta suele necesitar varias oraciones |
| `POST /chat` | El de la Fase 1: 15 cada 5 minutos y 100 por día; cada turno de voz usa uno |
| Grabación por turno | 60 s en el cliente y 3 MB en el servidor |
| Texto por síntesis | 500 caracteres por oración |
| Voz sin actividad | El modo de voz se desactiva solo tras 3 minutos sin voz |

**Validaciones del servidor.** Tipo y firma del archivo (`RIFF` y `WAVE` para WAV), duración calculada desde el encabezado y no desde lo que declare el cliente, tamaño, y largo del texto a sintetizar. La clave de OpenRouter vive solo en el servidor, CORS sigue cerrado y los registros no incluyen el contenido de la transcripción ni del audio.

**Privacidad**

- El micrófono solo se abre con el modo de voz activo y con el permiso del navegador, y un indicador visible muestra cuándo se está escuchando.
- El audio no se guarda: el navegador lo envía, el servidor lo reenvía al proveedor de STT desde la memoria y no lo escribe en disco, ni en Storage, ni en la base. Se conserva solo la transcripción, como cualquier mensaje del chat.
- El audio sale hacia un proveedor externo para transcribirse y sintetizarse. OpenRouter ofrece, en las solicitudes de STT y de TTS, la opción de enrutar solo a proveedores sin retención de datos (ZDR); se activa si el modelo elegido la admite, y esa disponibilidad se confirma antes de elegir.
- El aviso del chat debe decir que, al usar la voz, el audio se envía a un proveedor para transcribirlo y no se guarda. La voz puede ser un dato personal, así que el texto se revisa con asesoría legal, igual que el aviso de privacidad de la Fase 1.

**Costos**

| Concepto | Se cobra por | Cómo se controla |
| --- | --- | --- |
| Transcripción (STT) | Segundo de audio o tokens, según el modelo | Voz mínima de 400 ms, frases de hasta 60 s, modelo económico de STT |
| Respuesta del agente (LLM) | Tokens | Instrucciones de voz que piden respuestas cortas |
| Síntesis (TTS) | Carácter de texto | Oraciones cortas y pedidas por separado: al interrumpir no se piden las siguientes |

El costo por turno y por conversación se mide en las pruebas, se registra por conversación para el equipo y se acota con un tope de gasto mensual con alertas en OpenRouter.

## 9. Criterios de aceptación y pruebas

La decisión de si esta modalidad alcanza o hace falta pasar a conversación en tiempo real depende de dos números: cuántas veces se interrumpe sin que nadie haya hablado y cuánto tarda el primer sonido. Por eso se miden desde el primer prototipo, en el dispositivo y el entorno reales.

| Métrica | Cómo se mide | Meta inicial |
| --- | --- | --- |
| Latencia al primer sonido | Del fin de voz (`onSpeechEnd`) al primer audio reproducido, medida en el cliente | Menos de 4 s (percentil 95) |
| Falsas interrupciones | Interrupciones confirmadas sin que hablara una persona, sobre el total de respuestas, con altavoces y ruido de sala | Menos del 5 % |
| Error de transcripción | Proporción de palabras mal transcritas sobre frases de prueba dichas por 3 a 5 personas | A definir con el prototipo |
| Turnos completados | Turnos sin error sobre el total | Más del 95 % |
| Costo por conversación | Reporte de OpenRouter dividido por conversaciones de prueba | Dentro del presupuesto que se fije |

| N.º | Criterio de aceptación | Cómo se verifica | Requerimiento |
| --- | --- | --- | --- |
| 1 | Activar la voz pide el permiso, abre el micrófono y muestra «Escuchando»; si se deniega, el chat de texto sigue operativo con un mensaje claro | Prueba manual en Chrome, Edge, Android e iOS | RV-01, RV-09 |
| 2 | Una frase en español se transcribe, aparece en el hilo y la respuesta suena por oraciones mientras se muestra el texto | Prueba manual con 10 frases | RV-03, RV-05 |
| 3 | Las 30 preguntas de la evaluación de la Fase 1, dictadas, cumplen sus mismos criterios: ninguna invención en las 8 sin cobertura | Evaluación con audios | RV-04 |
| 4 | El primer sonido llega en menos de 4 s (percentil 95) en 30 turnos con conexión normal | Medición en el cliente | Latencia |
| 5 | Hablar durante la respuesta corta el audio en menos de 300 ms, y 20 interrupciones seguidas no dejan el controlador en un estado inconsistente | Prueba manual y prueba del controlador con detector simulado | RV-06 |
| 6 | Una tos o un ruido breve durante la respuesta no la cancela, sino que se reanuda, en al menos 9 de 10 intentos | Prueba manual | RV-11 |
| 7 | Con los altavoces de un portátil a volumen medio hay como máximo una interrupción espuria por cada 20 respuestas | Prueba manual | RV-11 |
| 8 | Tras interrumpir, nada del turno cancelado llega al hilo ni al audio | Prueba automatizada del `turnId` | RV-06 |
| 9 | Con el STT caído, el TTS caído o la red cortada, el controlador muestra un mensaje y vuelve a Escuchando sin bloquearse | Pruebas con fallas simuladas | RV-09 |
| 10 | La conversación aparece en el panel con canal `voice`, transcripciones y modalidad, y no hay audio guardado en Storage ni en la base | Revisión del panel y de la base | RV-10 |
| 11 | Superar el límite de tasa devuelve 429 y el cliente lo explica; un WAV falso o de más de 3 MB es rechazado | Pruebas automatizadas | Sección 8 |
| 12 | El costo por conversación de prueba está medido y dentro del presupuesto | Reporte de OpenRouter | Sección 8 |

| Nivel | Qué cubre | Herramienta sugerida |
| --- | --- | --- |
| Unitarias | Cabecera del WAV, partición en oraciones (números con decimales, abreviaturas), limpieza de markdown | Vitest |
| Controlador | Tabla de transiciones y carreras (respuesta tardía de un turno cancelado) con detector, reproductor y red simulados | Vitest con temporizadores falsos |
| Integración de la API | Rutas de voz con archivos de ejemplo y proveedores simulados, límites y errores | Vitest |
| Extremo a extremo | Activar la voz, un turno completo y una interrupción, con el micrófono falso de Chromium alimentado con un archivo de audio | Playwright |
| Evaluación de voz | Las 30 preguntas como audio contra el agente, comparadas con la evaluación de texto | Script propio |
| Dispositivos reales | Altavoces, ruido ambiente y móviles: es la prueba que decide si la modalidad alcanza | Manual, con registro de las métricas |

## 10. Plan, riesgos y decisiones

El primer hito es un prototipo para medir, no para entregar: sus resultados deciden si la voz por turnos alcanza o si conviene pasar a conversación en tiempo real, así que se hace antes de construir el resto.

&#91;embedded content: plan por hitos · cuatro hitos en cinco semanas\]

| Hito | Semanas | Entregables | Se cierra cuando |
| --- | --- | --- | --- |
| 1. Prototipo y medición | S1 | Detector de voz en el navegador, codificación WAV, `/voice/transcribe` y `/voice/speech` básicos, un turno de punta a punta sin interfaz definitiva; pruebas con altavoces, ruido y móviles | Se miden la latencia y las falsas interrupciones y se decide si la modalidad alcanza |
| 2. Controlador y chat | S2 a S3 | Máquina de estados, cola de audio por oraciones, limpieza de markdown, integración con `/chat` y el canal `voice`, instrucciones de voz, botón e indicador de estado | Un turno completo funciona con el agente real (criterios 2, 3 y 4) |
| 3. Interrupciones | S4 | Pausa y confirmación, `turnId` y cancelación, eco y umbral dinámico, manejo de errores, historial con canal y modalidad | Criterios 5 a 10 |
| 4. Seguridad y salida | S5 | Límites de tasa de voz, validaciones del servidor, aviso de privacidad, medición de costos, pruebas de extremo a extremo y en dispositivos | Aceptación completa de la sección 9 |

**Riesgos**

| Riesgo | Probabilidad | Impacto | Mitigación |
| --- | --- | --- | --- |
| El eco y el ruido causan interrupciones espurias | Alta | Alto | Pausar antes de cancelar, umbral dinámico, cancelación de eco del navegador y pruebas en dispositivos reales desde el hito 1; si no se logra, usar audífonos o pasar a conversación en tiempo real |
| La latencia supera la meta, porque suma STT por archivo, LLM y TTS | Media | Alto | TTS por oraciones, respuestas breves, modelos rápidos; se mide en el hito 1 |
| Calidad de STT y TTS en español de Chile | Media | Medio | Probar 2 o 3 modelos de OpenRouter con frases reales antes de fijar uno |
| Audio, permisos y gestos en Safari de iOS | Media | Medio | Desbloquear el audio con el clic de activar y probar en iPhone desde el hito 1 |
| Peso del modelo del detector en móviles | Media | Bajo | Descargarlo solo al activar la voz, cachearlo y medir |
| Cambios de API en Mastra, Assistant UI y el detector | Media | Medio | Versiones fijadas y una capa propia (`vad.ts`, `audio-queue.ts`) |
| Costo por abuso de rutas públicas | Media | Medio | Límites de la sección 8 y tope de gasto mensual |
| El historial omite respuestas interrumpidas | Media | Bajo | Limitación aceptada y documentada (sección 7) |

**Decisiones abiertas**

| Decisión | Recomendación | Quién decide |
| --- | --- | --- |
| Detector de voz | `@ricky0123/vad-web` (Silero en el navegador) con la versión fijada; el paquete antiguo `@ricky0123/vad` figura como obsoleto | Equipo técnico |
| Modelos de STT y de TTS, y la voz | Probar candidatos de OpenRouter con frases reales y elegir por calidad en español, latencia y costo; la voz y el tono los valida Fab Lab | Equipo técnico y Fab Lab |
| Enrutar sin retención de datos (ZDR) | Activarlo en STT y TTS si el modelo elegido lo permite | Fab Lab y equipo técnico |
| Dónde se usará | Definir el dispositivo y el entorno (portátil con altavoces, móvil con audífonos, sala con ruido): determina el eco y la meta de falsas interrupciones | Fab Lab |
| Cuándo pasar a tiempo real | Evaluar la conversación en tiempo real (LiveKit) si, tras ajustar, las falsas interrupciones superan el 5 % o la latencia supera la meta | Fab Lab y equipo técnico |

**Fuentes** (páginas consultadas el 17 de octubre de 2026)

- [VAD para el navegador: referencia de la API](https://docs.vad.ricky0123.com/user-guide/api/)
- [VAD para el navegador: paquete en npm](https://www.npmjs.com/package/%40ricky0123%2Fvad)
- [Assistant UI: texto a voz](https://www.assistant-ui.com/docs/guides/speech)
- [Assistant UI: adaptadores](https://www.assistant-ui.com/docs/runtimes/concepts/adapters)
- [Mastra: voz, visión general](https://mastra.ai/reference/voice/overview)
- [Mastra: voz en tiempo real con LiveKit](https://mastra.ai/integrations/voice/livekit)
- [OpenRouter: texto a voz](https://openrouter.ai/docs/guides/overview/multimodal/tts)
- [OpenRouter: voz a texto](https://openrouter.ai/docs/guides/overview/multimodal/stt)
