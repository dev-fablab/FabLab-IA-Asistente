import { Globe, Mail, MapPin, MessageCircle, Phone, Share2, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { isChannelType, TYPE_LABELS, type ChannelType } from '@/lib/contact';

/** Un icono por tipo de canal, para reconocerlo sin leer. */
export const CHANNEL_ICONS: Record<ChannelType, LucideIcon> = {
  phone: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  web: Globe,
  social: Share2,
  address: MapPin,
};

export function ChannelTypeBadge({ type }: { type: string }) {
  const known = isChannelType(type);
  const Icon = known ? CHANNEL_ICONS[type] : Globe;
  return (
    <Badge variant="outline">
      <Icon aria-hidden />
      {known ? TYPE_LABELS[type] : type}
    </Badge>
  );
}
