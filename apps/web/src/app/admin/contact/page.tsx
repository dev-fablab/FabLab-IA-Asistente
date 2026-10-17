import type { Metadata } from 'next';
import { ContactManager } from '@/components/admin/contact/contact-manager';

export const metadata: Metadata = { title: 'Contacto · Panel Fab Lab' };

export default function ContactPage() {
  return <ContactManager />;
}
