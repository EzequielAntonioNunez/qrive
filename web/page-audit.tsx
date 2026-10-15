/** Registro de auditoría de la organización (pestaña «Auditoría» de Participantes y accesos; solo el propietario). */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from './app-context';
import { EmptyState, Icon } from './kit';
import { Link } from './router';
import { errorText } from './types';
import { Sk } from './ui';

export type AuditEntry = {
  id: string; action: string; at: string; sessionId: string | null;
  actorKind: 'member' | 'guest' | 'system' | 'former'; actorName: string;
  detail: Record<string, unknown>;
};

const ACTIONS: Record<string, string> = {
  session_created: 'Sesión creada', session_duplicated: 'Sesión duplicada', session_renamed: 'Sesión renombrada',
  session_exported: 'Sesión exportada', session_deleted: 'Sesión eliminada', session_retention_deleted: 'Sesión borrada por plazo de conservación',
  session_pin_regenerated: 'PIN de la sesión regenerado', advance: 'Siguiente situación', pause: 'Sesión en pausa', resume: 'Sesión reanudada',
  complete: 'Sesión finalizada', incident: 'Incidente lanzado', 'set-meter': 'Indicador ajustado',
  participant_removed: 'Participante retirado de una sesión', participant_exported: 'Datos de un participante exportados',
  guest_joined: 'Invitado unido con PIN', demo_class_added: 'Clase simulada añadida', demo_class_removed: 'Clase simulada retirada',
  member_upserted: 'Alta o cambio de miembro', member_deleted: 'Baja de miembro', access_code_issued: 'Código personal generado',
  access_code_revoked: 'Código personal revocado', scenario_published: 'Escenario publicado', scenario_published_from_ai: 'Escenario publicado desde el Modo IA',
  knowledge_collection_created: 'Colección de documentos creada', knowledge_collection_deleted: 'Colección de documentos eliminada',
  knowledge_document_uploaded: 'Documento subido', knowledge_document_deleted: 'Documento eliminado',
  ai_run_created: 'Partida del Modo IA creada', ai_run_deleted: 'Partida del Modo IA eliminada'
};

export function auditActionLabel(action: string): string { return ACTIONS[action] ?? action; }

function detailText(detail: Record<string, unknown>): string {
  return Object.entries(detail).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(' · ');
}

export function AuditPanel() {
  const app = useApp();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (before: string | null) => {
    setBusy(true);
    try {
      const result = await app.api<{ entries: AuditEntry[]; nextBefore: string | null }>(`/audit?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      setEntries(current => before ? [...(current ?? []), ...result.entries] : result.entries);
      setNext(result.nextBefore);
      setError('');
    } catch (cause) {
      setError(`No se ha podido cargar el registro: ${errorText(cause)}`);
      setEntries(current => current ?? []);
    } finally { setBusy(false); }
  }, [app.api]);
  useEffect(() => { void load(null); }, [load]);

  return <section className="card table-card" aria-labelledby="audit-log-title">
    <div className="card-head wrap"><div><h2 id="audit-log-title" className="card-title">Registro de auditoría</h2>
      <p className="card-sub">Acciones de la organización, de la más reciente a la más antigua. Se conservan 730 días. Solo lo ve el propietario.</p></div>
      <button className="btn" onClick={() => void load(null)} disabled={busy}><Icon name="clock" size={16}/>Actualizar</button></div>
    {error && <div className="error" role="alert"><span>{error}</span><button className="text-button" onClick={() => void load(null)}>Reintentar</button></div>}
    {entries === null ? <div className="table-wrap" aria-busy="true"><table className="table"><tbody>{[0, 1, 2, 3].map(i => <tr key={i} aria-hidden="true"><td><Sk w={120} h={12}/></td><td><Sk w={200} h={12}/></td><td><Sk w={120} h={12}/></td><td className="hide-sm"><Sk w={160} h={12}/></td></tr>)}</tbody></table></div>
    : entries.length === 0 ? <EmptyState icon="report" title="Sin entradas">Cuando alguien cree sesiones, gestione accesos o exporte datos, lo verás aquí.</EmptyState>
    : <div className="table-wrap"><table className="table">
      <caption className="sr-only">Registro de auditoría</caption>
      <thead><tr><th scope="col">Fecha</th><th scope="col">Acción</th><th scope="col">Quién</th><th scope="col" className="hide-sm">Detalle</th></tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.id}>
        <td className="muted-cell tabular">{new Date(entry.at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' })}</td>
        <th scope="row">{auditActionLabel(entry.action)}{entry.sessionId && <small className="audit-session"> · <Link to={`/sesiones/${entry.sessionId}`}>ver sesión</Link></small>}</th>
        <td>{entry.actorName}</td>
        <td className="hide-sm"><small className="muted-cell audit-detail">{detailText(entry.detail) || '—'}</small></td>
      </tr>)}</tbody></table></div>}
    {next && <div className="card-foot"><button className="btn" onClick={() => void load(next)} disabled={busy}>{busy ? 'Cargando…' : 'Cargar más'}</button></div>}
    <p className="fine-print">El registro usa identificadores seudónimos y nunca guarda códigos, frases de voz ni texto de documentos.</p>
  </section>;
}
