import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'Asistente Virtual Fab Lab',
  description: 'Resuelve tus dudas sobre Fab Lab con la documentación oficial.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-CL" className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
