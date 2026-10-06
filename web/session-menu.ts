/** Menú de acciones de una sesión, el mismo en Inicio, el listado y el detalle. Se adapta al estado y a la propiedad. */
import type { SessionActions } from './app-context';
import type { MenuItem } from './kit';
import type { SessionSummary } from './types';

export function sessionMenu(session: SessionSummary, actions: SessionActions, options: { mine: boolean; standalone: boolean; omit?: string[]; afterDelete?: () => void }): MenuItem[] {
  const { mine, omit = [] } = options;
  const open = session.status !== 'complete';
  const items: (MenuItem & { key?: string })[] = [];
  const add = (key: string, item: Exclude<MenuItem, 'separator'>) => { if (!omit.includes(key)) items.push(item); };
  add('open', { label: 'Abrir', icon: 'next', onSelect: () => actions.open(session.id) });
  add('project', { label: 'Proyectar en clase', icon: 'project', onSelect: () => actions.project(session.id) });
  if (open) add('copy', { label: 'Copiar enlace para participantes', icon: 'link', onSelect: () => void actions.copyLink(session.id) });
  if (mine && session.status === 'active') add('pause', { label: 'Pausar', icon: 'pause', onSelect: () => void actions.pause(session.id) });
  if (mine && session.status === 'paused') add('resume', { label: 'Reanudar', icon: 'play', onSelect: () => void actions.resume(session.id) });
  if (mine && open) add('finish', { label: 'Finalizar', icon: 'stop', onSelect: () => void actions.finish(session) });
  add('report', { label: session.status === 'complete' ? 'Ver informe' : 'Ver informe provisional', icon: 'report', onSelect: () => actions.report(session.id) });
  const tail: MenuItem[] = [];
  if (mine && !omit.includes('rename')) tail.push({ label: 'Renombrar', icon: 'edit', onSelect: () => void actions.rename(session) });
  if (!omit.includes('duplicate')) tail.push({ label: 'Duplicar', icon: 'copy', onSelect: () => void actions.duplicate(session) });
  if (mine && !omit.includes('export')) tail.push({ label: 'Exportar datos (JSON)', icon: 'download', onSelect: () => void actions.exportData(session) });
  const result: MenuItem[] = [...items];
  if (tail.length) result.push('separator', ...tail);
  if (mine && !omit.includes('delete')) result.push('separator', { label: 'Eliminar', icon: 'trash', danger: true, onSelect: () => void actions.remove(session).then(done => { if (done) options.afterDelete?.(); }) });
  return result;
}
