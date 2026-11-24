import { useEffect } from 'react';
import Lenis from 'lenis';

export function useLenis() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let lenis: Lenis | null = null;

    const enable = () => {
      if (lenis) return;
      lenis = new Lenis({
        autoRaf: true,
        lerp: 0.1,
        smoothWheel: true,
        anchors: true,
      });
    };

    const disable = () => {
      if (!lenis) return;
      lenis.destroy();
      lenis = null;
    };

    if (!motionQuery.matches) {
      enable();
    }

    const handleMotionChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        disable();
      } else {
        enable();
      }
    };

    motionQuery.addEventListener('change', handleMotionChange);

    return () => {
      motionQuery.removeEventListener('change', handleMotionChange);
      disable();
    };
  }, []);
}
