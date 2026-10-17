'use client';

import { useEffect, type RefObject } from 'react';

/** Píxeles de un evento de rueda: algunos dispositivos envían líneas o páginas en lugar de píxeles. */
export function wheelPixels(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, pageHeight: number): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * pageHeight;
  return event.deltaY;
}

/** ¿Hay un elemento con scroll propio entre `target` y la raíz que pueda moverse en esa dirección (p. ej. una caja de texto larga)? */
function scrollsItself(target: EventTarget | null, root: HTMLElement, delta: number): boolean {
  for (let node = target instanceof HTMLElement ? target : null; node && node !== root; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    const canScroll = delta < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight;
    if (canScroll) return true;
  }
  return false;
}

/**
 * Hace que la rueda (o el trackpad) desplace el hilo del chat desde cualquier parte de la pantalla: la barra
 * superior, las franjas laterales o la caja de texto. Si el cursor ya está sobre el hilo, el navegador lo
 * desplaza solo; una caja de texto con scroll propio conserva su comportamiento.
 */
export function useForwardWheel(viewport: RefObject<HTMLElement | null>) {
  useEffect(() => {
    function onWheel(event: WheelEvent) {
      const element = viewport.current;
      if (!element || event.ctrlKey || event.defaultPrevented) return; // Ctrl + rueda es zoom del navegador.
      if (event.target instanceof Node && element.contains(event.target)) return;

      const delta = wheelPixels(event, element.clientHeight);
      if (scrollsItself(event.target, document.body, delta)) return;

      // Sin `scroll-smooth`: con muchos eventos seguidos la animación se queda atrás de la rueda.
      element.scrollBy({ top: delta, behavior: 'instant' });
    }

    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, [viewport]);
}
