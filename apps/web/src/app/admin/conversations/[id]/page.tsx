import type { Metadata } from 'next';
import { ConversationDetailView } from '@/components/admin/conversations/conversation-detail';

export const metadata: Metadata = { title: 'Conversación · Panel Fab Lab' };

export default async function ConversationPage(props: PageProps<'/admin/conversations/[id]'>) {
  const { id } = await props.params;
  return <ConversationDetailView id={id} />;
}
