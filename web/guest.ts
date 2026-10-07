/**
 * Acceso de invitado (unión por código y alias, sin cuenta). Las rutas públicas /unirse y /jugar se pintan fuera
 * de la consola: no pasan por el acceso con correo y código ni envían la cabecera de la identidad de demo.
 */
export type GuestError = Error & { status?: number };

/** Petición a la API con la cookie de invitado (mismo origen, JSON). Lanza el texto de error del servidor. */
export async function guestApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  let body: T & { error?: string };
  try { const text = await response.text(); body = (text ? JSON.parse(text) : {}) as T & { error?: string }; }
  catch { body = {} as T & { error?: string }; }
  if (!response.ok) throw Object.assign(new Error(body.error ?? `Error ${response.status}`), { status: response.status }) as GuestError;
  return body;
}

/** Identidad devuelta por GET /api/me: la del invitado (plana) o la de un miembro (dentro de `identity`). */
export type GuestMe = {
  id?: string; name?: string; role?: string; guest?: boolean; sessionId?: string | null;
  identity?: { id: string; name: string; role: string };
  flags?: { phase_timers?: boolean; realtime_websocket?: boolean };
};
export function meId(me: GuestMe | null): string | null { return me?.id ?? me?.identity?.id ?? null; }
export function meName(me: GuestMe | null): string { return me?.name ?? me?.identity?.name ?? ''; }

export type JoinInfo = { scenarioTitle: string; sessionName: string | null; status: string };
export type JoinResult = { sessionId: string; alias: string; participantId: string };

/** UUID para los comandos. `crypto.randomUUID` solo existe en contextos seguros (HTTPS o localhost). */
export function commandId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Vibración breve si el dispositivo la admite (y el usuario no ha pedido reducir el movimiento). */
export function haptic(pattern: number | number[]) {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate?.(pattern);
  } catch { /* sin vibración */ }
}

/** Rutas públicas: /unirse, /unirse/:pin y /jugar/:sessionId. */
export type PublicRoute = { name: 'join'; pin: string | null } | { name: 'play'; id: string };
export function parsePublicRoute(pathname: string): PublicRoute | null {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/unirse') return { name: 'join', pin: null };
  const join = path.match(/^\/unirse\/(\d{6})$/);
  if (join) return { name: 'join', pin: join[1] };
  const play = path.match(/^\/jugar\/([\w-]{1,80})$/);
  if (play) return { name: 'play', id: play[1] };
  return null;
}

const ALIAS_KEY = 'ufv-alias';
export function rememberedAlias(): string { try { return localStorage.getItem(ALIAS_KEY) ?? ''; } catch { return ''; } }
export function rememberAlias(alias: string) { try { localStorage.setItem(ALIAS_KEY, alias); } catch { /* sin almacenamiento */ } }
