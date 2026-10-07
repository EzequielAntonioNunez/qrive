/**
 * Contexto de la consola: API con la identidad, listado de sesiones, catálogo de escenarios y acciones de sesión
 * reutilizables (las mismas desde Inicio, el listado y el detalle). Las acciones destructivas piden confirmación.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Scenario } from '../shared/simulation';
import { useDialogs } from './kit';
import { navigate } from './router';
import { errorText, plural, sessionTitle, type Identity, type ScenarioSummary, type SessionPayload, type SessionSummary } from './types';
import { useToast } from './ui';

export type ApiError = Error & { status?: number };
export type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

export type AppContextValue = {
  api: Api;
  identity: Identity;
  isInstructor: boolean;
  demo: boolean;
  standalone: boolean;
  timersOn: boolean;
  realtime: boolean;
  canAssignInstructor: boolean;
  sessions: SessionSummary[] | null;
  reloadSessions: () => Promise<void>;
  updateSession: (id: string, patch: Partial<SessionSummary>) => void;
  dropSessions: (ids: string[]) => void;
  scenarios: ScenarioSummary[] | null;
  scenarioDetails: Record<string, Scenario>;
  loadScenario: (id: string) => Promise<Scenario | null>;
  /** Vuelve a pedir el listado de escenarios (p. ej., tras publicar uno) y olvida el detalle en caché de `id`. */
  reloadScenarios?: (forget?: string) => Promise<void>;
};

export const AppContext = createContext<AppContextValue | null>(null);
export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppContext ausente');
  return value;
}

/** Enlace del simulador WebGL. En local Vite no resuelve /simulador/ a index.html, así que se enlaza el fichero. */
export function simulatorUrl(sessionId: string, demo: boolean): string {
  return `${window.location.origin}/simulador/${demo ? 'index.html' : ''}?sesion=${encodeURIComponent(sessionId)}`;
}

export function scenarioTitleOf(session: SessionSummary, scenarios: ScenarioSummary[] | null): string {
  return session.scenarioTitle || scenarios?.find(item => item.id === session.scenarioId)?.title || 'Simulación';
}
export function titleOf(session: SessionSummary, scenarios: ScenarioSummary[] | null): string {
  return sessionTitle(session, scenarioTitleOf(session, scenarios));
}
/** «Mía» si el servidor lo indica; si no, por el instructor de la sesión; sin datos, se asume que sí (modo local). */
export function isMine(session: SessionSummary, identity: Identity): boolean {
  if (typeof session.mine === 'boolean') return session.mine;
  if (session.instructorId) return session.instructorId === identity.id;
  return true;
}
/** Duración estimada: suma de los límites de tiempo de las situaciones (null si ninguna tiene límite). */
export function estimatedMinutes(scenario: Scenario | undefined): number | null {
  if (!scenario) return null;
  const seconds = scenario.phases.reduce((sum, phase) => sum + (phase.timeLimitSec ?? 0), 0);
  return seconds > 0 ? Math.round(seconds / 60) : null;
}
export function download(blob: Blob, filename: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
export function slug(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sesion';
}

/* «Demo rápida»: estado global (una sola demo a la vez, aunque haya varios botones montados). */
export const QUICK_DEMO_SCENARIO = 'ia-buenas-practicas';
export const QUICK_DEMO_CLASS = 20;
export const QUICK_DEMO_STEPS = ['Creando la sesión', `Incorporando ${QUICK_DEMO_CLASS} participantes simulados`, 'Abriendo el proyector'] as const;
export type QuickDemoState = { running: boolean; step: number };
let quickDemoState: QuickDemoState = { running: false, step: 0 };
const quickDemoListeners = new Set<() => void>();
function setQuickDemo(next: QuickDemoState) { quickDemoState = next; quickDemoListeners.forEach(listener => listener()); }
export function useQuickDemoState(): QuickDemoState {
  return useSyncExternalStore(listener => { quickDemoListeners.add(listener); return () => { quickDemoListeners.delete(listener); }; }, () => quickDemoState);
}
function quickDemoName(date = new Date()): string {
  const day = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace(/\.$/, '');
  return `Demo · ${day}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Acciones sobre sesiones con avisos y confirmaciones. Devuelven el nuevo estado cuando el servidor lo envía. */
export function useSessionActions() {
  const app = useApp();
  const toast = useToast();
  const { confirm, prompt } = useDialogs();
  const appRef = useRef(app);
  appRef.current = app;

  const command = useCallback(async (id: string, type: 'pause' | 'resume' | 'advance' | 'complete', quiet = false): Promise<SessionPayload | null> => {
    try {
      const result = await appRef.current.api<SessionPayload>(`/sessions/${encodeURIComponent(id)}/commands`, { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), type }) });
      if (result?.state) appRef.current.updateSession(id, { status: result.state.status, phaseIndex: result.state.phaseIndex, phaseCount: result.state.scenario.phases.length, participantCount: result.state.participants.length });
      if (!quiet) toast(({ pause: 'Sesión en pausa', resume: 'Sesión reanudada', advance: 'Nueva situación abierta', complete: 'Sesión finalizada. El informe ya está disponible.' } as const)[type]);
      void appRef.current.reloadSessions();
      return result;
    } catch (cause) {
      if (!quiet) toast(errorText(cause), 'error');
      throw cause;
    }
  }, [toast]);

  return useMemo(() => {
    const titleFor = (session: SessionSummary) => titleOf(session, appRef.current.scenarios);
    return {
      command,
      open(id: string) { navigate(`/sesiones/${id}`); },
      report(id: string) { navigate(`/sesiones/${id}?vista=informe`); },
      project(id: string) {
        if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => undefined);
        navigate(`/sesiones/${id}?vista=directo`);
      },
      /**
       * Demo rápida: crea una sesión del escenario por defecto, añade la clase simulada y abre el proyector.
       * La pantalla completa se pide aquí, antes de cualquier await, para que cuente como gesto del clic.
       */
      async quickDemo(): Promise<string | null> {
        if (quickDemoState.running) return null;
        setQuickDemo({ running: true, step: 0 });
        try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => undefined); } catch { /* sin pantalla completa */ }
        let id: string;
        try {
          const result = await appRef.current.api<SessionPayload>('/sessions', { method: 'POST', body: JSON.stringify({ scenarioId: QUICK_DEMO_SCENARIO, name: quickDemoName() }) });
          if (!result?.state?.id) throw new Error('El servidor no ha devuelto la sesión.');
          id = result.state.id;
        } catch (cause) {
          setQuickDemo({ running: false, step: 0 });
          if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => undefined);
          toast(`No se ha podido crear la sesión de demo: ${errorText(cause)}`, 'error');
          return null;
        }
        setQuickDemo({ running: true, step: 1 });
        let classError: unknown = null;
        try { await appRef.current.api(`/sessions/${encodeURIComponent(id)}/demo-class`, { method: 'POST', body: JSON.stringify({ count: QUICK_DEMO_CLASS }) }); }
        catch (cause) { classError = cause; }
        setQuickDemo({ running: true, step: 2 });
        void appRef.current.reloadSessions();
        navigate(`/sesiones/${id}?vista=directo`);
        setQuickDemo({ running: false, step: 0 });
        if (classError) {
          const status = (classError as ApiError).status;
          toast(status === 404 || status === 405 || status === 501 ? 'No se ha podido añadir la clase simulada: este servidor aún no la admite. Añádela desde el panel de la sesión.' : `No se ha podido añadir la clase simulada: ${errorText(classError)}`, 'error');
        } else toast(`Demo lista: ${QUICK_DEMO_CLASS} participantes simulados irán decidiendo en los próximos segundos.`);
        return id;
      },
      async copyLink(id: string) {
        try { await navigator.clipboard.writeText(simulatorUrl(id, appRef.current.demo)); toast('Enlace para participantes copiado'); }
        catch { toast('No se ha podido copiar. Abre la sesión y copia el enlace a mano.', 'error'); }
      },
      async pause(id: string) { return command(id, 'pause').catch(() => null); },
      async resume(id: string) { return command(id, 'resume').catch(() => null); },
      async finish(session: SessionSummary, detail?: { pendingPhases: number; pendingPeople: number }) {
        const pending = detail?.pendingPhases ?? (session.phaseCount != null && session.phaseIndex != null ? session.phaseCount - session.phaseIndex - 1 : 0);
        // El docente puede cerrar en cualquier momento; si quedan situaciones, se avisa de que el cierre es anticipado.
        const ok = await confirm({
          title: pending > 0 ? '¿Finalizar la sesión antes de tiempo?' : '¿Finalizar la sesión?',
          body: <><p>Se cerrará «{titleFor(session)}». Los participantes ya no podrán decidir y el informe quedará cerrado con las decisiones registradas.</p>
            {pending > 0 && <p>{plural(pending, 'situación quedará sin jugar', 'situaciones quedarán sin jugar')}; el informe solo reflejará las situaciones ya trabajadas.</p>}
            {!!detail?.pendingPeople && <p>{plural(detail.pendingPeople, 'participante aún no ha decidido', 'participantes aún no han decidido')} en la situación actual; conservarán sus indicadores.</p>}</>,
          confirmLabel: 'Finalizar sesión'
        });
        if (!ok) return null;
        return command(session.id, 'complete').catch(() => null);
      },
      async rename(session: SessionSummary) {
        const value = await prompt({ title: 'Renombrar sesión', label: 'Nombre de la sesión', initial: session.name ?? '', placeholder: titleFor(session), maxLength: 80, hint: 'Visible solo para docentes. Ej.: «1.º Derecho · Grupo A».', confirmLabel: 'Guardar nombre' });
        if (value == null || value === (session.name ?? '')) return;
        const previous = session.name ?? null;
        appRef.current.updateSession(session.id, { name: value });
        try {
          const result = await appRef.current.api<{ session?: SessionSummary }>(`/sessions/${encodeURIComponent(session.id)}`, { method: 'PATCH', body: JSON.stringify({ name: value }) });
          if (result.session) appRef.current.updateSession(session.id, result.session);
          toast('Nombre actualizado');
        } catch (cause) {
          appRef.current.updateSession(session.id, { name: previous });
          const status = (cause as ApiError).status;
          toast(status === 404 || status === 405 ? 'Renombrar aún no está disponible en este servidor.' : `No se ha podido renombrar: ${errorText(cause)}`, 'error');
        }
      },
      async duplicate(session: SessionSummary) {
        try {
          const result = await appRef.current.api<SessionPayload>(`/sessions/${encodeURIComponent(session.id)}/duplicate`, { method: 'POST', body: '{}' });
          await appRef.current.reloadSessions();
          toast('Sesión duplicada. Comparte el nuevo enlace con tu grupo.');
          if (result?.state?.id) navigate(`/sesiones/${result.state.id}`);
        } catch (cause) {
          const status = (cause as ApiError).status;
          toast(status === 404 || status === 405 ? 'Duplicar aún no está disponible en este servidor.' : `No se ha podido duplicar: ${errorText(cause)}`, 'error');
        }
      },
      async exportData(session: SessionSummary) {
        try {
          const data = await appRef.current.api<unknown>(`/sessions/${encodeURIComponent(session.id)}/export`);
          const day = new Date(session.createdAt);
          const date = Number.isNaN(day.getTime()) ? '' : `-${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
          download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `simulador-ufv-${slug(titleFor(session))}${date}.json`);
          toast('Exportación descargada');
        } catch (cause) { toast(`No se ha podido exportar: ${errorText(cause)}`, 'error'); }
      },
      async remove(session: SessionSummary): Promise<boolean> {
        const ok = await confirm({
          title: '¿Eliminar la sesión?',
          tone: 'danger',
          body: <><p>Vas a eliminar «{titleFor(session)}»{session.status !== 'complete' ? ', que sigue abierta. Los participantes conectados perderán el acceso al momento' : ''}.</p><p className="modal-warn">Se borrarán las decisiones, los indicadores y el informe. No se puede deshacer. Si los necesitas, exporta antes los datos.</p></>,
          confirmLabel: 'Eliminar definitivamente'
        });
        if (!ok) return false;
        try {
          await appRef.current.api(`/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
          appRef.current.dropSessions([session.id]);
          toast('Sesión eliminada');
          void appRef.current.reloadSessions();
          return true;
        } catch (cause) { toast(`No se ha podido eliminar: ${errorText(cause)}`, 'error'); return false; }
      },
      async bulkFinish(list: SessionSummary[]): Promise<number> {
        const open = list.filter(item => item.status !== 'complete');
        if (!open.length) { toast('Las sesiones seleccionadas ya están finalizadas.', 'info'); return 0; }
        const ok = await confirm({ title: `¿Finalizar ${plural(open.length, 'sesión', 'sesiones')}?`, body: <><p>Los participantes ya no podrán decidir y los informes quedarán cerrados.</p><p className="modal-warn">Las que no hayan llegado a su última situación se cerrarán antes de tiempo, con las decisiones registradas hasta ahora.</p></>, confirmLabel: 'Finalizar' });
        if (!ok) return 0;
        let done = 0;
        for (const item of open) { try { await command(item.id, 'complete', true); done++; } catch { /* se informa en el resumen */ } }
        toast(done === open.length ? `${plural(done, 'sesión finalizada', 'sesiones finalizadas')}` : `${plural(done, 'sesión finalizada', 'sesiones finalizadas')}; ${open.length - done} no se ${open.length - done === 1 ? 'ha' : 'han'} podido cerrar todavía.`, done === open.length ? 'ok' : 'info');
        void appRef.current.reloadSessions();
        return done;
      },
      async bulkRemove(list: SessionSummary[]): Promise<string[]> {
        const ok = await confirm({ title: `¿Eliminar ${plural(list.length, 'sesión', 'sesiones')}?`, tone: 'danger', body: <><p>{list.filter(item => item.status !== 'complete').length ? 'Algunas siguen abiertas: los participantes perderán el acceso al momento. ' : ''}Se borrarán decisiones, indicadores e informes.</p><p className="modal-warn">No se puede deshacer.</p></>, confirmLabel: `Eliminar ${plural(list.length, 'sesión', 'sesiones')}` });
        if (!ok) return [];
        const removed: string[] = [];
        for (const item of list) { try { await appRef.current.api(`/sessions/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); removed.push(item.id); } catch { /* resumen abajo */ } }
        appRef.current.dropSessions(removed);
        toast(removed.length === list.length ? `${plural(removed.length, 'sesión eliminada', 'sesiones eliminadas')}` : `${plural(removed.length, 'sesión eliminada', 'sesiones eliminadas')}; ${list.length - removed.length} no se han podido eliminar (solo quien la creó puede hacerlo).`, removed.length === list.length ? 'ok' : 'info');
        void appRef.current.reloadSessions();
        return removed;
      }
    };
  }, [command, confirm, prompt, toast]);
}

export type SessionActions = ReturnType<typeof useSessionActions>;

export function AppProvider({ value, children }: { value: AppContextValue; children: React.ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
