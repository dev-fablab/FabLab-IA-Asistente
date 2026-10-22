# Especificación de Calendario y Reuniones – Asistente Fab Lab

Oct 20, 2026 · @Diego Cancino

## 1. Resumen y alcance

El módulo de calendario permite que el asistente consulte la disponibilidad de Fab Lab y agende una reunión presencial con una persona, y que el equipo vea esas reuniones en el panel, defina cuándo atiende y lleve el acta de cada una. Reemplaza el aviso «agendar aún no está disponible» de la Fase 1 (RF-07 y el criterio de aceptación 4).

**Dentro del alcance**

- Dos herramientas del agente: `getAvailableSlots` (consulta) y `scheduleMeeting` (reserva).
- Contactos: toda reunión pertenece a un contacto, que se registra en el flujo del agente (nombre, correo) y se reconoce por su correo.
- Horario base editable (lunes a viernes, 08:00 a 20:00) y excepciones por fecha.
- Sección «Calendario» del panel con el componente Event Calendar de ReUI, detalle de la reunión en un modal y acta editable.

**Fuera del alcance**

- Avisos por correo o recordatorios (a la persona ni al equipo).
- Avisar a la persona (por correo u otro medio) cuando el equipo reagenda su reunión o cambia al responsable.
- Verificar que el correo pertenezca a quien escribe.
- Agendar una reunión a mano desde el panel para una persona registrada por el equipo (hoy las reuniones las crea el asistente).
- Reuniones virtuales, varios recursos o salas, y duración variable: cada reunión dura 60 minutos.
- Sincronizar con Google Calendar u otro calendario externo.

## 2. Requerimientos

| ID | Requerimiento | Prioridad |
| --- | --- | --- |
| RC-01 | El horario base inicial es de lunes a viernes, de 08:00 a 20:00, en la hora de Fab Lab (`America/Santiago`) | Debe |
| RC-02 | El equipo modifica el horario semanal (varias ventanas por día) y agrega excepciones por fecha: cierres de día completo o de un tramo, y aperturas | Debe |
| RC-03 | Cada reunión ocupa un bloque de 60 minutos y es presencial; dos reuniones agendadas nunca se solapan | Debe |
| RC-04 | El agente consulta los horarios reales antes de ofrecer uno y nunca los inventa | Debe |
| RC-05 | Para agendar, el agente obtiene nombre, correo, motivo y horario; si el correo ya es un contacto no vuelve a pedir el nombre | Debe |
| RC-06 | El agente confirma los datos con la persona antes de reservar y no afirma que quedó agendada si la herramienta no lo confirma | Debe |
| RC-07 | Al hacer clic en una reunión el panel abre un modal con el nombre de la persona, el resumen de la conversación que originó la reserva y el acta | Debe |
| RC-08 | El acta es una lista de puntos: el agente deja los de la conversación (necesidad, idea más pulida, requerimientos) y el equipo agrega, edita y borra | Debe |
| RC-09 | El equipo cancela una reunión (libera el horario) o la marca como realizada | Debe |
| RC-10 | Ver desde la reunión la conversación completa que la originó | Debería |
| RC-11 | Cada reunión tiene un responsable del equipo (staff o admin) que la lleva a cabo. Nace sin asignar, el panel lo advierte, y cualquier persona del equipo, staff o admin, lo asigna y lo cambia libremente (o lo quita) | Debe |
| RC-12 | El equipo reagenda arrastrando la reunión en el calendario, o con fecha y hora desde el detalle. Solo dentro del horario de atención, sin chocar con otra reunión agendada y sin ir al pasado; la duración no cambia | Debe |
| RC-13 | El sidebar tiene el grupo «Calendario» con dos páginas: «Agenda» (el calendario de reuniones) y «Personas» (quienes se relacionan con Fab Lab, vengan por el chat o las registre el equipo) | Debe |
| RC-14 | Cada persona tiene nombre y correo siempre obligatorios, un medio por el que llegó (Chat, Presencial, Teléfono, WhatsApp, Correo, Redes sociales u Otro) y, opcionalmente, otros medios de contacto. El equipo (staff o admin) las registra y las edita; las que crea el asistente quedan como «Chat» | Debe |

## 3. Modelo de datos

| Tabla | Contenido |
| --- | --- |
| `contacts` | Las personas (la sección «Personas» del panel). `name`, `email` (siempre obligatorios; el correo es único sin distinguir mayúsculas y se guarda en minúsculas), `source` (el medio por el que llegó la primera vez; las que crea el asistente quedan en `chat`), `created_by` (quién del equipo la registró; nulo si la creó el asistente o si esa persona sale del equipo) |
| `contact_methods` | Otros medios de contacto de una persona (teléfono, WhatsApp, redes, web, dirección u otro correo), con los mismos tipos y la misma validación que los canales de Fab Lab. Máximo 10 por persona; se ignoran los repetidos y el que repite el correo principal |
| `availability_rules` | Ventanas semanales: `weekday` (0 = domingo), `start_minute`, `end_minute` |
| `availability_exceptions` | `date`, `kind` (`closed` / `open`), ventana opcional, `note`. Un cierre sin horas cierra el día entero |
| `meetings` | `contact_id`, `conversation_id` (nulo si se borra), `responsible_id` (perfil del equipo; nulo si no hay o si la persona sale del equipo), `starts_at`, `ends_at`, `status` (`scheduled`, `completed`, `cancelled`), `reason`, `conversation_summary` |
| `meeting_minutes` | Puntos del acta: `content`, `source` (`agent` / `staff`), `sort_order` |

Las seis tablas tienen RLS activo sin políticas y sin privilegios para `anon` y `authenticated`, igual que el resto: el acceso es solo por la API.

**No solapamiento.** Una restricción de exclusión (`EXCLUDE USING gist (tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'scheduled')`) es la garantía final. Además, cada reserva toma un lock de transacción (`pg_advisory_xact_lock`) que las serializa; sin él, dos reservas simultáneas del mismo bloque terminaban en un deadlock de Postgres (código `40P01`) en lugar de un rechazo limpio.

## 4. Cálculo de disponibilidad

Una sola función (`computeDayAvailability`, en `packages/db/src/calendar/slots.ts`) decide qué se ofrece y qué se puede reservar:

1. Ventanas del día = horario semanal del día más las aperturas de esa fecha, menos los cierres (un cierre siempre gana sobre una apertura).
2. Bloques de 60 minutos desde el inicio de cada ventana.
3. Se descartan los bloques que empiezan antes de ahora más 2 horas y los que se solapan con una reunión agendada.

`getAvailableSlots` entrega ese resultado y `scheduleMeeting` revalida contra él dentro de la transacción, de modo que un horario que no fue ofrecido no se puede reservar. Solo se agenda hasta 60 días adelante. Las reuniones canceladas no ocupan horario.

## 5. Herramientas del agente

**`getAvailableSlots({ from?, days? })`.** Por día entrega `open` (horas de atención), `free` (bloques reservables con su `start` ISO y una etiqueta lista para decir) y `busy` (bloques ocupados **sin** nombre ni motivo). Por defecto, los próximos 7 días; máximo 14.

**`scheduleMeeting({ name?, email?, reason?, startsAt?, conversationSummary?, keyPoints? })`.** Todos los campos son opcionales para que la herramienta pueda guiar en lugar de fallar. Responde con un `status`:

| `status` | Significado | Qué hace el agente |
| --- | --- | --- |
| `needs_info` | Faltan o son inválidos datos (`missing`, `invalid`). Incluye `contact: 'existing' \| 'new'` cuando el correo es válido | Pide solo lo que falta. El nombre se exige únicamente a un contacto nuevo |
| `booked` | Reunión creada | Confirma día, hora y motivo |
| `slot_unavailable` | El bloque ya no está libre o no fue ofrecido; trae `alternatives` | Ofrece las alternativas |
| `limit_reached` | La persona o la conversación llegó al tope de reuniones activas | Lo explica y entrega los canales de contacto |
| `unavailable` | Falla técnica (con `unavailable: true`, como las demás herramientas) | Lo dice y no reintenta |

`startsAt` es el `start` ISO que entrega `getAvailableSlots`. Si el modelo lo escribe sin zona (`2026-10-20T12:00`) se entiende como hora de Fab Lab y no como la del servidor; cualquier otro formato se rechaza como inválido.

El `conversationId` sale del `RequestContext` del servidor, nunca del modelo. `conversationSummary` y `keyPoints` los redacta el agente y se guardan como resumen de la reserva y como acta inicial (`source = 'agent'`).

### Responsable y reagendado

El agente no conoce al equipo, así que la reunión nace sin responsable y no se asigna sola. El panel lo señala (bloque en amarillo en el calendario y la insignia «Sin responsable» en el detalle) hasta que alguien la toma con «Asignarme a mí» o se la asigna a otra persona. Staff y admin tienen el mismo permiso: cualquiera de los dos puede ser responsable y cualquiera puede reasignar. El asistente no ve ni menciona al responsable.

Reagendar (`rescheduleMeeting`, en `packages/db/src/calendar/reschedule.ts`) es la decisión del servidor; el panel solo avisa antes. La regla es distinta de la de una reserva nueva a propósito: el equipo mueve reuniones por temas de agenda, así que no se exige la rejilla de bloques ni las 2 horas de anticipación, pero sí lo esencial:

- Solo se mueven reuniones **agendadas**; una realizada o cancelada responde `409`.
- El bloque entero debe caber en una ventana de atención (horario base más excepciones) y no cruzar la medianoche; si no, `400`.
- No puede quedar en el pasado (`400`) ni chocar con otra reunión agendada, ni siquiera de forma parcial (`409`). Quedar pegada al final de otra es válido.
- Comparte el lock de transacción de las reservas y la restricción de exclusión: mover y reservar el mismo horario a la vez deja pasar a uno solo.
- Un pedido que combina cambios (por ejemplo horario y responsable) se rechaza entero si el reagendado falla.

Después de mover, el asistente ve el horario nuevo en el turno siguiente, porque su estado verificado se lee de la base.

### Continuidad entre turnos

El agente no tiene estado: cada turno recibe el hilo que reenvía el navegador, y el servidor descarta de ese hilo las partes de herramientas para que nadie falsifique resultados (`sanitizeThread`). Eso significa que en el turno siguiente el modelo ve su propio «quedó agendada» sin ningún resultado detrás. Sin más información, duda de sí mismo y se retracta, que es lo que ocurrió en la primera prueba real: la reunión se había creado y el asistente terminó diciendo que no.

Por eso, en cada turno el servidor lee de la base las reuniones que se agendaron desde esa conversación (`listConversationMeetings`) y las entrega en las instrucciones como sección **«Estado verificado»**, que prevalece sobre cualquier mensaje anterior:

- Con reuniones: día y hora, estado (agendada, realizada o cancelada), nombre y motivo. El texto de la persona entra como dato: una línea, recortada y entre comillas.
- Sin reuniones: «ninguna agendada desde esta conversación; no afirmes que hay una».
- Si no se pudo leer (falla de la base de datos): «no se pudo verificar»; el agente no afirma ni niega la reserva y ofrece los canales de contacto.

Con una reunión ya agendada, el agente no vuelve a llamar a `scheduleMeeting` para ese horario. Cambiar o cancelar se coordina con el equipo (no hay una herramienta para ello). La evaluación (`tests/eval`) no pasa por el chat, así que no lleva esta sección.

## 6. Rutas de administración

Bajo `/admin/calendar`, protegidas por `requireStaff` como el resto de `/admin/*`:

| Ruta | Uso |
| --- | --- |
| `GET /people?page&q&source` | Personas de a 25: medio, reuniones que llevan (sin contar las canceladas), cuántas por venir y cuándo es la próxima; primero quienes tienen una reunión por venir. Busca por nombre o correo y filtra por medio |
| `POST /people` | Registra a una persona (nombre, correo, medio y medios adicionales opcionales); queda anotado quién la creó. Un correo repetido, aunque cambien las mayúsculas, responde `409` |
| `GET /people/:id` | Una persona con sus medios de contacto, quién la registró y todas sus reuniones, la más reciente primero, con estado y responsable |
| `PATCH /people/:id` | Edita nombre, correo, medio y/o la lista completa de medios adicionales. Un correo que ya es de otra persona responde `409` y no cambia nada |
| `GET /meetings?from&to` | Reuniones no canceladas del rango (máximo 100 días); fechas ISO con o sin offset |
| `GET /meetings/:id` | Detalle: la persona (con su medio y sus otros medios de contacto), motivo, resumen, enlace a la conversación y acta |
| `PATCH /meetings/:id` | Cambiar el estado, el horario (`startsAt`, reagendar) y/o el responsable (`responsibleId`, `null` lo quita); al menos uno. Reactivar una cancelada responde `409` si otra reunión tomó el horario |
| `GET /admin/team` | Todo el equipo (staff y admin) con su rol, para elegir al responsable |
| `POST /meetings/:id/minutes`, `PATCH`, `DELETE /minutes/:id` | Acta |
| `GET /availability`, `PUT /availability/rules` | Horario semanal (reemplazo completo; las ventanas de un día no pueden solaparse) |
| `GET /availability/open-hours?from&to` | Ventanas de atención por día; el calendario las usa para sombrear lo que no se atiende |
| `POST`, `DELETE /availability/exceptions` | Excepciones por fecha |

## 7. Panel

El grupo «Calendario» del sidebar es desplegable y tiene dos páginas: **Personas** (`/admin/calendar/people`) y **Agenda** (`/admin/calendar/agenda`). `/admin/calendar` redirige a la agenda, así que los enlaces antiguos siguen funcionando. El grupo se abre solo mientras se navega dentro de él, y si la persona lo abre o lo cierra a mano se respeta su elección.

**Personas** lista a quienes se relacionan con Fab Lab con su medio, cuántas reuniones llevan y cuándo es la próxima. Se busca por nombre o correo y se filtra por medio; ambos y la página viven en la URL, como en el historial. Cada fila se despliega con sus otros medios de contacto (con enlace `tel:`, `mailto:`, wa.me o web según el tipo), quién la registró y sus reuniones; cada reunión abre el mismo detalle de la agenda. «Agregar persona» y «Editar» abren un formulario con nombre, correo, medio y una lista de medios de contacto adicionales; al agregar a alguien, la lista pasa a buscar su correo para que se vea aunque hubiera filtros. No hay borrado: una persona con reuniones no debe desaparecer.

**Agenda** usa el componente Event Calendar de ReUI, variante Radix, instalado con `shadcn add @reui/event-calendar` en `apps/web/src/components/reui/event-calendar/`. Se usa controlado: la API entrega las reuniones del rango visible y el calendario no guarda nada. Vistas semana, día, mes y agenda; español, semana desde el lunes y hora de Santiago.

- Las horas fuera del horario de atención se sombrean en las vistas por hora, y los días sin atención se marcan en la vista de mes.
- Hacer clic en una reunión abre el modal de detalle (RC-07, RC-08, RC-09, RC-10).
- «Disponibilidad» abre el editor del horario semanal y de las excepciones (RC-02).
- Arrastrar una reunión agendada la reagenda. Mientras se arrastra, el calendario marca los bloques donde no cabe (misma regla que el servidor); al soltar se muestra el movimiento de inmediato, se guarda, y si la API lo rechaza la reunión vuelve a su lugar y se explica el motivo. Tras mover aparece «Deshacer». No se redimensiona: la duración es fija.
- Las reuniones realizadas y canceladas no se arrastran.
- El detalle tiene el selector de responsable (todo el equipo, con su rol), «Asignarme a mí» y un formulario de fecha y hora para reagendar, que también sirve a quien no usa el arrastre (teclado, pantallas táctiles).
- Cada bloque muestra a la persona y al responsable, o «sin responsable».

Los archivos del registro `@reui` se tratan como código generado: están excluidos del lint y cuatro de ellos llevan `// @ts-nocheck` porque no cumplen `noUncheckedIndexedAccess`. Si se reinstalan con `--overwrite`, hay que volver a poner esa línea.

## 8. Seguridad y privacidad

- La herramienta de reserva es la primera de escritura y es pública y anónima: se acota con tope de reuniones activas por correo (2) y por conversación (2), validación de correo y de largos, y el límite de tasa del chat. El texto de la persona se trata como dato, nunca como instrucción.
- No se revelan datos de contactos: la herramienta solo informa si el correo es `existing` o `new` (no devuelve el nombre guardado) y un contacto existente no se modifica desde el chat. Aun así, saber si un correo está registrado es una señal; el límite de tasa es el control.
- Las reuniones ocupadas se informan al chat sin nombres ni motivos.
- Se pasa de conversaciones anónimas a guardar nombre y correo: conviene un aviso de privacidad visible en el chat y definir con Fab Lab cuánto tiempo se conservan los datos. El agente avisa al agendar que los datos se usan solo para coordinar la reunión.
- Limitación conocida: nadie verifica que el correo sea de quien escribe, así que una persona puede reservar con el correo de otra.

## 9. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
| --- | --- | --- |
| 1 | Pedir horarios o agendar hace que el agente consulte `getAvailableSlots` y no reserve sin datos ni confirmación | `tests/eval`, categoría `scheduling` (requiere modelo real) |
| 2 | Con un correo nuevo se pide el nombre; con uno existente no | `calendar.integration.test.ts` |
| 3 | Dos reservas simultáneas del mismo bloque: una se concreta y la otra recibe `slot_unavailable` | `calendar.integration.test.ts` |
| 4 | Un horario fuera de la rejilla, del horario de atención o pasado se rechaza | `calendar.integration.test.ts` |
| 5 | La reserva queda ligada a su conversación y aparece en el panel con resumen y acta | `calendar.integration.test.ts` (flujo completo con modelo simulado) |
| 6 | Cancelar libera el horario y reactivarlo con el horario tomado da `409` | `calendar.integration.test.ts` |
| 7 | Todas las rutas `/admin/calendar/*` responden 401 sin sesión y 403 sin perfil | `require-staff.test.ts` |
| 8 | El modal muestra a la persona (con su medio y otros medios de contacto), el resumen y el acta, y permite editar el acta | `meeting-detail-dialog.test.tsx` |
| 9 | Cambiar el horario semanal o una excepción cambia lo que el asistente ofrece | `calendar.integration.test.ts` |
| 14 | El sidebar muestra Calendario como grupo con Personas y Agenda, lo abre en esas páginas y marca la actual; Personas lista, busca, filtra por medio, pagina y despliega los medios de contacto y las reuniones de cada una | `admin-sidebar.test.tsx`, `people-manager.test.tsx`, `calendar.integration.test.ts` |
| 15 | El equipo registra y edita personas con nombre y correo obligatorios; un correo repetido se rechaza sin cambiar nada; los medios adicionales se validan por tipo, sin repetidos; el asistente reconoce a una persona registrada por el equipo (no le pide el nombre ni cambia su ficha) y las que crea el asistente quedan como «Chat» | `calendar.integration.test.ts`, `people-manager.test.tsx` |
| 11 | La reunión nace sin responsable; staff y admin pueden asignarla, cambiarla y quitarla; una persona fuera del equipo se rechaza; si el responsable sale del equipo la reunión no se pierde | `calendar.integration.test.ts`, `meeting-detail-dialog.test.tsx` |
| 12 | Reagendar mueve la reunión conservando la duración y libera el horario anterior; se rechaza fuera de horario, un día cerrado, el pasado, el choque parcial y las reuniones no agendadas; un pedido rechazado no deja cambios a medias | `calendar.integration.test.ts`, `calendar.test.ts` |
| 13 | El arrastre valida mientras se mueve, guarda con el instante exacto, revierte si la API lo rechaza y permite deshacer | `use-meeting-mover.test.tsx` |
| 10 | En el turno siguiente a una reserva, con el hilo solo en texto, el agente recibe la reunión como estado verificado; si el equipo la cancela, el estado lo refleja; una conversación sin reservas lo dice | `calendar.integration.test.ts` |

Quedan sin cubrir con pruebas automáticas el gesto real de arrastrar con el puntero (jsdom no tiene geometría; lo cubren la validación pura y el hook que decide y guarda), el tamaño del calendario en móvil y el comportamiento del agente con un modelo real.

## 10. Decisiones

| Tema | Decisión |
| --- | --- |
| Horario base | 08:00 a 20:00. El requerimiento decía «12:00 a. m. a 8:00 p. m.»; se tomó la jornada diurna y queda editable |
| Variante del componente | Radix, la que coincide con el estilo `radix-nova` del proyecto; la variante Base UI duplicaría primitivas |
| Acta | La prellena el agente y la edita el equipo |
| Duración | 60 minutos fijos |
| Nombre de la sección | «Personas» (antes «Solicitantes»): sirve igual para quien llegó por el chat que para quien registra el equipo. Se descartaron «Contactos», que choca con la sección «Contacto» de los canales de Fab Lab, y «Usuarios», que se confunde con los del panel |
| Medio de la persona | Una sola etiqueta por persona (cómo llegó la primera vez); no se guarda por reunión |
| Datos de contacto | Nombre y correo siempre obligatorios; los demás medios son opcionales y se agregan aparte |
| Responsable | Nace sin asignar y lo asigna el equipo; no hay asignación automática |
| Reagendar | Solo dentro del horario de atención, sin solapar y sin ir al pasado |
| Pendiente con Fab Lab | Si hace falta enviar confirmación por correo, cuánto se conservan los datos de contacto y si la duración debe ser configurable |
