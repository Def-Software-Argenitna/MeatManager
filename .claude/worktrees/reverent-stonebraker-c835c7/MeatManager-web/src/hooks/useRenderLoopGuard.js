import { useRef } from 'react';

/**
 * Guardrail de desarrollo para detectar loops de render (sin tocar estado).
 * Si un componente supera X renders en una ventana de tiempo corta,
 * deja un warning en consola una sola vez por ventana.
 */
export const useRenderLoopGuard = (componentName, options = {}) => {
    const { maxRenders = 60, windowMs = 1200 } = options;
    const metricsRef = useRef({
        windowStartMs: 0,
        renderCount: 0,
        warned: false,
    });

    if (!import.meta.env.DEV) return;

    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();

    const metrics = metricsRef.current;
    if (!metrics.windowStartMs || now - metrics.windowStartMs > windowMs) {
        metrics.windowStartMs = now;
        metrics.renderCount = 1;
        metrics.warned = false;
        return;
    }

    metrics.renderCount += 1;

    if (!metrics.warned && metrics.renderCount > maxRenders) {
        metrics.warned = true;
        const stack = new Error().stack;
        console.warn(
            `[RenderLoopGuard] ${componentName} superó ${maxRenders} renders en ${windowMs}ms. Revisar effects/setState encadenados.`,
            stack
        );
    }
};
