'use client';

import type { GetAvailableSlotsResult, GetContactInfoResult, GetDocumentLinkResult, ScheduleMeetingResult } from '@fablab/agent';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { CalendarCheck, CalendarClock, Download, FileText, Mail, MapPin, MessageCircle, Phone, Globe } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { formatClock, formatDay } from '@/lib/calendar';
import { contactHref } from '@/lib/chat/links';
import { cn } from '@/lib/utils';

// Mientras una herramienta corre, el indicador de la respuesta (`TypingIndicator`) dice qué está haciendo.

/** `searchDocuments` no muestra nada propio: la respuesta ya nombra el documento. */
export const SearchDocumentsUI: ToolCallMessagePartComponent = () => null;

/** `getDocumentLink`: una tarjeta por coincidencia, con título y botón «Descargar» (RF-05). */
export const DocumentLinkUI: ToolCallMessagePartComponent<Record<string, unknown>, GetDocumentLinkResult> = ({
  result,
}) => {
  const matches = Array.isArray(result?.matches) ? result.matches : [];
  if (matches.length === 0) return null;

  return (
    <ul className="my-2 flex flex-col gap-2" aria-label="Documentos disponibles">
      {matches.map((match) => (
        <li key={match.url} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
          <span className="flex min-w-0 items-center gap-2">
            <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium" title={match.title}>
                {match.title}
              </span>
              <span className="block text-xs text-muted-foreground">El enlace vence en {match.expiresInMinutes} minutos</span>
            </span>
          </span>
          <a
            href={match.url}
            download={match.fileName}
            rel="noopener noreferrer"
            className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}
            aria-label={`Descargar ${match.title}`}
          >
            <Download aria-hidden /> Descargar
          </a>
        </li>
      ))}
    </ul>
  );
};

const CHANNEL_ICONS = {
  phone: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  address: MapPin,
  web: Globe,
  social: Globe,
} as const;

type Channel = GetContactInfoResult['channels'][number];

/** Un canal de contacto: con enlace accionable cuando el tipo lo permite (`tel:`, `mailto:`…). */
export function ContactChannelItem({ channel }: { channel: Channel }) {
  const Icon = CHANNEL_ICONS[channel.type as keyof typeof CHANNEL_ICONS] ?? Globe;
  const href = contactHref(channel.type, channel.value);

  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{channel.label}</span>
        {href ? (
          <a
            href={href}
            {...(href.startsWith('http') && { target: '_blank', rel: 'noopener noreferrer' })}
            className="font-medium break-words underline underline-offset-4"
          >
            {channel.value}
          </a>
        ) : (
          <span className="font-medium break-words">{channel.value}</span>
        )}
        {channel.notes && <span className="block text-xs text-muted-foreground">{channel.notes}</span>}
      </span>
    </li>
  );
}

export function ContactList({ channels }: { channels: Channel[] }) {
  return (
    <ul className="flex flex-col gap-3" aria-label="Canales de contacto">
      {channels.map((channel) => (
        <ContactChannelItem key={`${channel.type}-${channel.value}`} channel={channel} />
      ))}
    </ul>
  );
}

/** `getContactInfo`: una tarjeta con cada canal activo (RF-06). */
export const ContactInfoUI: ToolCallMessagePartComponent<Record<string, unknown>, GetContactInfoResult> = ({
  result,
}) => {
  const channels = Array.isArray(result?.channels) ? result.channels : [];
  if (channels.length === 0) return null;

  return (
    <section className="my-2 rounded-lg border bg-card p-3" aria-label="Contacto de Fab Lab">
      <ContactList channels={channels} />
    </section>
  );
};

/** Días con horarios libres que se muestran; el resto se ofrece al pedirlo. */
const MAX_DAYS_SHOWN = 5;

/** `getAvailableSlots`: los horarios libres por día, para elegir uno respondiendo en el chat. */
export const AvailableSlotsUI: ToolCallMessagePartComponent<Record<string, unknown>, GetAvailableSlotsResult> = ({ result }) => {
  const days = (Array.isArray(result?.days) ? result.days : []).filter((day) => day.free.length > 0).slice(0, MAX_DAYS_SHOWN);
  if (days.length === 0) return null;

  return (
    <section className="my-2 rounded-lg border bg-card p-3" aria-label="Horarios disponibles">
      <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarClock className="size-4" aria-hidden /> Reuniones presenciales de {result?.durationMinutes} minutos (hora de Fab Lab)
      </p>
      <ul className="flex flex-col gap-2">
        {days.map((day) => (
          <li key={day.date} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="w-40 text-sm font-medium capitalize">{formatDay(day.date)}</span>
            <ul className="flex flex-wrap gap-1.5" aria-label={`Horarios del ${formatDay(day.date)}`}>
              {day.free.map((slot) => (
                <li key={slot.start} className="rounded-md border bg-muted/50 px-2 py-0.5 text-xs tabular-nums">
                  {formatClock(slot.start)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
};

/** `scheduleMeeting`: la confirmación solo aparece cuando la reunión quedó realmente agendada. */
export const MeetingBookedUI: ToolCallMessagePartComponent<Record<string, unknown>, ScheduleMeetingResult> = ({ result }) => {
  if (result?.status !== 'booked' || !result.meeting) return null;

  return (
    <section className="my-2 flex items-start gap-3 rounded-lg border border-success/40 bg-success/5 p-3" aria-label="Reunión agendada">
      <CalendarCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-medium">Reunión agendada</p>
        <p className="capitalize">{result.meeting.label}</p>
        <p className="text-xs text-muted-foreground">Presencial en Fab Lab · {result.meeting.reason}</p>
      </div>
    </section>
  );
};

/** Herramientas del agente con interfaz propia; las demás no se muestran. */
export const toolUIs = {
  by_name: {
    searchDocuments: SearchDocumentsUI,
    getDocumentLink: DocumentLinkUI,
    getContactInfo: ContactInfoUI,
    getAvailableSlots: AvailableSlotsUI,
    scheduleMeeting: MeetingBookedUI,
  },
  Fallback: () => null,
};
