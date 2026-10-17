import { ChatApp } from '@/components/chat/chat-app';

export default function HomePage() {
  return (
    // Fijo al viewport: el documento no puede crecer más que la ventana, así que nunca hay scroll de página ni
    // espacio en blanco bajo el chat (con `h-svh` en un contenedor normal, cualquier píxel de más lo provocaba).
    <main className="fixed inset-0 overflow-hidden">
      <ChatApp />
    </main>
  );
}
