import { Mail, MessageCircle, MessageSquare, MoreHorizontal, Phone, Share2, Users, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { isSource, SOURCE_LABELS, type ContactSource } from '@/lib/calendar';

export const SOURCE_ICONS: Record<ContactSource, LucideIcon> = {
  chat: MessageSquare,
  in_person: Users,
  phone: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  social: Share2,
  other: MoreHorizontal,
};

/** El medio por el que llegó la persona (Chat, Presencial, Teléfono...), como etiqueta. */
export function SourceBadge({ source }: { source: string }) {
  const known = isSource(source);
  const Icon = known ? SOURCE_ICONS[source] : MoreHorizontal;
  return (
    <Badge variant="outline">
      <Icon aria-hidden />
      {known ? SOURCE_LABELS[source] : source}
    </Badge>
  );
}
