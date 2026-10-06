/** Listado de sesiones: búsqueda, filtros, orden, selección múltiple y menú de acciones por fila. */
import React, { useEffect, useMemo, useState } from 'react';
import { isMine, scenarioTitleOf, titleOf, useApp, useSessionActions } from './app-context';
import { ActionMenu, EmptyState, Icon, PageHeader, SearchField, StatusPill } from './kit';
import { FirstRunPath, progressText, peopleText } from './page-home';
import { Link, navigate, setQuery, useLocation } from './router';
import { sessionMenu } from './session-menu';
import { relativeDate, type SessionSummary } from './types';
import { Sk } from './ui';

type Filter = 'todas' | 'abiertas' | 'en-curso' | 'en-pausa' | 'finalizadas' | 'mias';
const FILTERS: [Filter, string][] = [['todas', 'Todas'], ['en-curso', 'En curso'], ['en-pausa', 'En pausa'], ['finalizadas', 'Finalizadas'], ['mias', 'Mías']];
type Sort = 'recientes' | 'antiguas' | 'nombre' | 'estado';
const PAGE = 25;
const STATUS_ORDER: Record<string, number> = { active: 0, paused: 1, complete: 2 };

export function SessionsPage() {
  const app = useApp();
  const actions = useSessionActions();
  const { query: params } = useLocation();
  const filter = (FILTERS.some(([key]) => key === params.get('estado')) || params.get('estado') === 'abiertas' ? params.get('estado') : 'todas') as Filter;
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('recientes');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { sessions, identity, scenarios } = app;

  const counts = useMemo(() => {
    const list = sessions ?? [];
    return { todas: list.length, abiertas: list.filter(s => s.status !== 'complete').length, 'en-curso': list.filter(s => s.status === 'active').length, 'en-pausa': list.filter(s => s.status === 'paused').length, finalizadas: list.filter(s => s.status === 'complete').length, mias: list.filter(s => isMine(s, identity)).length } as Record<Filter, number>;
  }, [sessions, identity]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (sessions ?? []).filter(item => {
      if (filter === 'abiertas' && item.status === 'complete') return false;
      if (filter === 'en-curso' && item.status !== 'active') return false;
      if (filter === 'en-pausa' && item.status !== 'paused') return false;
      if (filter === 'finalizadas' && item.status !== 'complete') return false;
      if (filter === 'mias' && !isMine(item, identity)) return false;
      if (!needle) return true;
      return `${titleOf(item, scenarios)} ${scenarioTitleOf(item, scenarios)} ${item.instructorName ?? ''}`.toLowerCase().includes(needle);
    });
    const by = {
      recientes: (a: SessionSummary, b: SessionSummary) => b.createdAt.localeCompare(a.createdAt),
      antiguas: (a: SessionSummary, b: SessionSummary) => a.createdAt.localeCompare(b.createdAt),
      nombre: (a: SessionSummary, b: SessionSummary) => titleOf(a, scenarios).localeCompare(titleOf(b, scenarios), 'es'),
      estado: (a: SessionSummary, b: SessionSummary) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || b.createdAt.localeCompare(a.createdAt)
    }[sort];
    return [...list].sort(by);
  }, [sessions, filter, search, sort, identity, scenarios]);

  useEffect(() => { setLimit(PAGE); }, [filter, search, sort]);
  // La selección solo conserva sesiones que siguen existiendo.
  useEffect(() => { if (sessions) setSelected(current => new Set([...current].filter(id => sessions.some(item => item.id === id)))); }, [sessions]);

  const shown = rows.slice(0, limit);
  const selectable = shown.filter(item => isMine(item, identity));
  const allSelected = selectable.length > 0 && selectable.every(item => selected.has(item.id));
  const selectedRows = (sessions ?? []).filter(item => selected.has(item.id));
  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <div className="page">
    <PageHeader title="Sesiones" description="Todas las simulaciones de tu organización. Abre una para conducirla en directo o consultar su informe."
      actions={sessions?.length === 0 ? undefined : <button className="btn btn-primary" onClick={() => navigate('/sesiones/nueva')}><Icon name="plus" size={18}/>Nueva sesión</button>}/>

    {sessions?.length === 0 ? <EmptyForFilter filter="todas" search="" total={0} onClear={() => undefined}/> : <>
    <div className="toolbar">
      <SearchField value={search} onChange={setSearch} placeholder="Buscar por nombre, escenario o docente" label="Buscar sesiones"/>
      <div className="chips" role="group" aria-label="Filtrar por estado">{FILTERS.map(([key, label]) => <button key={key} type="button" className="chip" aria-pressed={filter === key} onClick={() => setQuery({ estado: key === 'todas' ? null : key }, { replace: true })}>{label}<span className="chip-count">{sessions ? counts[key] : ''}</span></button>)}
        {filter === 'abiertas' && <button type="button" className="chip" aria-pressed="true" onClick={() => setQuery({ estado: null }, { replace: true })}>Abiertas<span className="chip-count">{counts.abiertas}</span></button>}</div>
      <label className="select-inline"><span>Ordenar</span><select value={sort} onChange={event => setSort(event.target.value as Sort)}><option value="recientes">Más recientes</option><option value="antiguas">Más antiguas</option><option value="nombre">Nombre (A-Z)</option><option value="estado">Estado</option></select></label>
    </div>

    {selected.size > 0 && <div className="bulk-bar" role="region" aria-label="Acciones sobre la selección">
      <strong>{selected.size} {selected.size === 1 ? 'seleccionada' : 'seleccionadas'}</strong>
      <button className="btn btn-sm" onClick={() => void actions.bulkFinish(selectedRows).then(() => setSelected(new Set()))}><Icon name="stop" size={16}/>Finalizar</button>
      <button className="btn btn-sm btn-danger-quiet" onClick={() => void actions.bulkRemove(selectedRows).then(removed => { if (removed.length) setSelected(new Set()); })}><Icon name="trash" size={16}/>Eliminar</button>
      <button className="btn btn-sm btn-quiet" onClick={() => setSelected(new Set())}>Quitar selección</button>
    </div>}

    <div className="card table-card">
      {sessions === null ? <div className="table-wrap" aria-busy="true"><table className="table"><tbody>{[0, 1, 2, 3, 4].map(i => <tr key={i} aria-hidden="true"><td className="check-cell"><Sk w={16} h={16}/></td><td><Sk w={240} h={13}/><Sk w={170} h={10} className="sk-gap-s"/></td><td><Sk w={80} h={22}/></td><td className="hide-sm"><Sk w={110} h={12}/></td><td className="hide-md"><Sk w={90} h={12}/></td><td/></tr>)}</tbody></table><p className="sr-only" role="status">Cargando sesiones…</p></div>
      : rows.length === 0 ? <EmptyForFilter filter={filter} search={search} total={sessions.length} onClear={() => { setSearch(''); setQuery({ estado: null }, { replace: true }); }}/>
      : <div className="table-wrap"><table className="table sessions-table">
        <caption className="sr-only">Sesiones ({rows.length})</caption>
        <thead><tr>
          <th scope="col" className="check-cell"><input type="checkbox" aria-label="Seleccionar todas las sesiones visibles" checked={allSelected} disabled={!selectable.length} onChange={() => setSelected(current => { const next = new Set(current); if (allSelected) selectable.forEach(item => next.delete(item.id)); else selectable.forEach(item => next.add(item.id)); return next; })}/></th>
          <th scope="col">Sesión</th><th scope="col">Estado</th><th scope="col" className="hide-sm">Progreso</th><th scope="col" className="hide-md">Participantes</th><th scope="col" className="hide-md">Creada</th><th scope="col" className="hide-lg">Docente</th><th scope="col"><span className="sr-only">Acciones</span></th>
        </tr></thead>
        <tbody>{shown.map(item => {
          const mine = isMine(item, identity);
          const title = titleOf(item, scenarios);
          return <tr key={item.id} className={selected.has(item.id) ? 'selected' : ''}>
            <td className="check-cell"><input type="checkbox" aria-label={`Seleccionar ${title}`} checked={selected.has(item.id)} disabled={!mine} title={mine ? undefined : 'Solo quien creó la sesión puede finalizarla o eliminarla'} onChange={() => toggle(item.id)}/></td>
            <th scope="row" className="title-cell"><Link to={`/sesiones/${item.id}`}>{title}</Link><small>{scenarioTitleOf(item, scenarios)}<span className="show-sm"> · {relativeDate(item.createdAt)}</span></small></th>
            <td><StatusPill status={item.status}/></td>
            <td className="hide-sm muted-cell">{progressText(item) ?? '—'}</td>
            <td className="hide-md muted-cell">{peopleText(item) ?? '—'}</td>
            <td className="hide-md muted-cell nowrap">{relativeDate(item.createdAt)}</td>
            <td className="hide-lg muted-cell">{mine ? 'Tú' : item.instructorName ?? '—'}</td>
            <td className="menu-cell"><ActionMenu label={`Acciones de ${title}`} items={sessionMenu(item, actions, { mine, standalone: app.standalone })}/></td>
          </tr>;
        })}</tbody>
      </table></div>}
      {rows.length > shown.length && <div className="table-foot"><span>Mostrando {shown.length} de {rows.length}</span><button className="btn btn-sm" onClick={() => setLimit(value => value + PAGE)}>Mostrar más</button></div>}
      {rows.length > 0 && rows.length <= shown.length && rows.length > 8 && <div className="table-foot"><span>{rows.length} sesiones</span></div>}
    </div>
    </>}
  </div>;
}

function EmptyForFilter({ filter, search, total, onClear }: { filter: Filter; search: string; total: number; onClear: () => void }) {
  if (total === 0) return <div className="empty-hero"><EmptyState icon="sessions" title="Aquí aparecerán tus sesiones" action={<button className="btn btn-primary btn-lg" onClick={() => navigate('/sesiones/nueva')}><Icon name="plus" size={18}/>Crear tu primera sesión</button>}>Cada sesión es una simulación con tu grupo: la conduces en directo y al terminar tienes su informe de impacto.</EmptyState><FirstRunPath/></div>;
  if (search) return <EmptyState icon="search" title="Sin resultados" action={<button className="btn" onClick={onClear}>Limpiar filtros</button>}>Ninguna sesión coincide con «{search}».</EmptyState>;
  const text: Record<Filter, [string, string]> = {
    todas: ['Sin sesiones', ''],
    abiertas: ['No hay sesiones abiertas', 'Todas las sesiones están finalizadas.'],
    'en-curso': ['No hay sesiones en curso', 'Las sesiones activas aparecerán aquí mientras tu grupo decide.'],
    'en-pausa': ['No hay sesiones en pausa', 'Cuando pauses una sesión, la encontrarás aquí para reanudarla.'],
    finalizadas: ['Aún no hay sesiones finalizadas', 'Al finalizar una sesión, su informe de impacto queda disponible aquí.'],
    mias: ['No has creado ninguna sesión', 'Las sesiones que crees aparecerán en este filtro.']
  };
  return <EmptyState icon="sessions" title={text[filter][0]} action={<button className="btn" onClick={onClear}>Ver todas</button>}>{text[filter][1]}</EmptyState>;
}
