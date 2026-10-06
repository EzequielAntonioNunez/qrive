/**
 * Sesión en directo: WebSocket `/api/sessions/:id/live` con reconexión exponencial (1 s → 15 s, con jitter) y
 * consulta periódica de respaldo cada 2,5 s mientras el socket no está abierto. El servidor envía
 * `{ type: 'session', data }` al conectar y tras cada cambio; el cliente envía «ping» cada 25 s.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type LiveMode = 'idle' | 'live' | 'reconnecting' | 'polling';

const POLL_MS = 2500;
const PING_MS = 25000;
const MIN_RETRY_MS = 1000;
const MAX_RETRY_MS = 15000;

export function liveUrl(id: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/sessions/${encodeURIComponent(id)}/live`;
}

export function useLiveSession<T>(id: string | null, options: { fetchSession: (id: string) => Promise<T>; socket: boolean; onError?: (cause: unknown) => void; onGone?: () => void }) {
  const { fetchSession, socket, onError, onGone } = options;
  const [data, setData] = useState<T | null>(null);
  const [mode, setMode] = useState<LiveMode>('idle');
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  const idRef = useRef(id);
  idRef.current = id;

  useEffect(() => {
    setData(null);
    if (!id) { setMode('idle'); return; }
    let stopped = false;
    let open = false;
    let everOpen = false;
    let attempts = 0;
    let ws: WebSocket | null = null;
    let pollTimer: number | undefined;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;

    // Cada arranque del bucle de consulta tiene su generación: un bucle anterior en vuelo no se duplica.
    let generation = 0;
    const poll = async (gen = ++generation) => {
      window.clearTimeout(pollTimer);
      if (stopped || open || gen !== generation) return;
      try { const next = await fetchSession(id); if (!stopped && !open && gen === generation) setData(next); }
      catch (cause) { if (!stopped) errorRef.current?.(cause); }
      if (!stopped && !open && gen === generation) pollTimer = window.setTimeout(() => void poll(gen), POLL_MS);
    };

    const connect = () => {
      if (stopped) return;
      try { ws = new WebSocket(liveUrl(id)); }
      catch { scheduleRetry(); return; }
      ws.onopen = () => {
        open = true; everOpen = true; attempts = 0;
        window.clearTimeout(pollTimer);
        setMode('live');
        pingTimer = window.setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('ping'); }, PING_MS);
      };
      ws.onmessage = event => {
        if (typeof event.data !== 'string' || event.data === 'pong') return;
        try {
          const message = JSON.parse(event.data) as { type?: string; data?: T };
          if (message.type === 'session' && message.data) setData(message.data);
        } catch { /* mensaje no reconocido: se ignora */ }
      };
      ws.onclose = event => {
        window.clearInterval(pingTimer);
        const wasOpen = open;
        open = false; ws = null;
        if (stopped) return;
        // 4404: la sesión se ha eliminado. No se reintenta.
        if (event.code === 4404) { stopped = true; window.clearTimeout(pollTimer); setMode('idle'); goneRef.current?.(); return; }
        // Mientras no hubo socket, el bucle de consulta sigue activo; si se cae uno abierto, se reanuda.
        if (wasOpen) void poll();
        scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (stopped) return;
      setMode(everOpen ? 'reconnecting' : 'polling');
      const base = Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** attempts);
      attempts += 1;
      retryTimer = window.setTimeout(connect, base / 2 + Math.random() * (base / 2));
    };

    setMode('polling');
    void poll();
    if (socket && typeof WebSocket !== 'undefined') connect();

    return () => {
      stopped = true;
      window.clearTimeout(pollTimer); window.clearTimeout(retryTimer); window.clearInterval(pingTimer);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, [id, socket, fetchSession]);

  /** Sustituye el estado con la respuesta de un comando (evita esperar al siguiente mensaje). */
  const replace = useCallback((next: T) => { setData(next); }, []);
  const reload = useCallback(async () => {
    const current = idRef.current;
    if (!current) return;
    try { const next = await fetchSession(current); if (idRef.current === current) setData(next); }
    catch (cause) { errorRef.current?.(cause); }
  }, [fetchSession]);

  return { data, mode, replace, reload };
}
