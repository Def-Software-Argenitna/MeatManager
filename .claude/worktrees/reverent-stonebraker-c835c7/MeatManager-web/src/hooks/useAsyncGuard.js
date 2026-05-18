/**
 * useAsyncGuard — previene double-submit en handlers async.
 *
 * Retorna una función `guard(asyncFn)` que:
 *  - Devuelve una versión de asyncFn que no puede ejecutarse en paralelo
 *  - Si se llama mientras ya está corriendo, el segundo call se ignora
 *  - `isPending` es true mientras corre (útil para deshabilitar botones)
 *
 * Uso:
 *   const { guard, isPending } = useAsyncGuard();
 *   <button onClick={guard(handleSave)} disabled={isPending}>Guardar</button>
 */

import { useCallback, useRef, useState } from 'react';

export const useAsyncGuard = () => {
    const runningRef = useRef(false);
    const [isPending, setIsPending] = useState(false);

    const guard = useCallback((asyncFn) => {
        return async (...args) => {
            if (runningRef.current) return; // ignorar click duplicado
            runningRef.current = true;
            setIsPending(true);
            try {
                return await asyncFn(...args);
            } finally {
                runningRef.current = false;
                setIsPending(false);
            }
        };
    }, []);

    return { guard, isPending };
};
