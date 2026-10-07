/** Participantes y accesos: personas de la organización, sus códigos personales y los últimos accesos. */
import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useApp, type ApiError } from './app-context';
import { ActionMenu, EmptyState, Icon, Modal, PageHeader, SearchField, useDialogs, type MenuItem } from './kit';
import { initials } from './session-blocks';
import { errorText, plural, relativeDate, roleLabel, type CodeSummary, type CodeUse, type Member, type Role } from './types';
import { CopyButton, Sk, useToast } from './ui';

export function PeoplePage() {
  const app = useApp();
  const toast = useToast();
  const { confirm } = useDialogs();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [codes, setCodes] = useState<CodeSummary[]>([]);
  const [uses, setUses] = useState<CodeUse[]>([]);
  const [codesAvailable, setCodesAvailable] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<{ code: string; name: string; email: string } | null>(null);

  const loadMembers = useCallback(async () => {
    try { const result = await app.api<{ members: Member[] }>('/memberships'); setMembers(result.members); setError(''); }
    catch (cause) { setError(`No se han podido cargar las personas: ${errorText(cause)}`); setMembers(current => current ?? []); }
  }, [app.api]);
  const loadCodes = useCallback(async () => {
    try { const result = await app.api<{ codes: CodeSummary[]; uses: CodeUse[] }>('/access-codes'); setCodes(result.codes); setUses(result.uses); setCodesAvailable(true); }
    catch { setCodesAvailable(false); }
  }, [app.api]);
  useEffect(() => { void loadMembers(); void loadCodes(); }, [loadMembers, loadCodes]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (members ?? []).filter(member => (roleFilter === 'all' || member.role === roleFilter) && (!needle || `${member.name} ${member.email}`.toLowerCase().includes(needle)));
  }, [members, query, roleFilter]);
  const onlyMe = members !== null && members.every(member => member.id === app.identity.id);

  async function issue(member: Member) {
    if (codes.some(item => item.userId === member.id)) {
      const ok = await confirm({ title: 'Generar un código nuevo', body: <p>El código actual de {member.name} dejará de funcionar y tendrás que entregarle el nuevo.</p>, confirmLabel: 'Generar código nuevo' });
      if (!ok) return;
    }
    try {
      const result = await app.api<{ code: string }>(`/access-codes/${encodeURIComponent(member.id)}`, { method: 'POST', body: '{}' });
      setIssued({ code: result.code, name: member.name, email: member.email });
      void loadCodes();
    } catch (cause) { toast(`No se ha podido generar el código: ${errorText(cause)}`, 'error'); }
  }
  async function revoke(member: Member) {
    const ok = await confirm({ title: '¿Revocar el código?', tone: 'danger', body: <p>{member.name} no podrá volver a entrar con su código actual. Las sesiones abiertas en su navegador seguirán hasta que salga. Podrás generarle otro cuando quieras.</p>, confirmLabel: 'Revocar código' });
    if (!ok) return;
    try { await app.api(`/access-codes/${encodeURIComponent(member.id)}`, { method: 'DELETE' }); toast(`Código de ${member.name} revocado`); void loadCodes(); }
    catch (cause) { toast(`No se ha podido revocar: ${errorText(cause)}`, 'error'); }
  }
  async function remove(member: Member) {
    const ok = await confirm({ title: `¿Dar de baja a ${member.name}?`, tone: 'danger', body: <><p>Perderá el acceso a la organización y se revocará su código. Si no pertenece a otra organización, se borrarán también su nombre y su correo.</p><p className="modal-warn">Sus decisiones en sesiones pasadas se conservan con un identificador seudónimo. No se puede deshacer.</p></>, confirmLabel: 'Dar de baja' });
    if (!ok) return;
    try { await app.api(`/memberships/${encodeURIComponent(member.id)}`, { method: 'DELETE' }); setMembers(current => (current ?? []).filter(item => item.id !== member.id)); toast(`${member.name} se ha dado de baja`); void loadCodes(); }
    catch (cause) { const status = (cause as ApiError).status; toast(status === 404 || status === 405 ? 'Dar de baja aún no está disponible en este servidor.' : `No se ha podido dar de baja: ${errorText(cause)}`, 'error'); }
  }

  return <div className="page">
    <PageHeader title="Participantes y accesos" description="Da de alta a las personas de tu grupo y entrega a cada una su código personal de seis cifras."
      actions={onlyMe ? undefined : <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={18}/>Dar de alta</button>}/>
    {app.demo && !app.standalone && <p className="notice-inline">Entorno local: se entra con la identidad de demostración, así que los códigos no se piden al iniciar sesión.</p>}
    {error && <div className="error" role="alert"><span>{error}</span><button className="text-button" onClick={() => void loadMembers()}>Reintentar</button></div>}

    {onlyMe ? <div className="card empty-hero">
      <EmptyState icon="users" title="Da de alta a tu grupo" action={<button className="btn btn-primary btn-lg" onClick={() => setAdding(true)}><Icon name="plus" size={18}/>Dar de alta a la primera persona</button>}>Añade a cada participante con su nombre y su correo institucional. Después genera su código personal y entrégaselo por un canal privado.</EmptyState>
      <ol className="path"><li><span className="path-icon"><Icon name="users" size={20}/></span><div><small>Paso 1</small><strong>Da de alta</strong><p>Nombre y correo de cada participante.</p></div></li><li><span className="path-icon"><Icon name="key" size={20}/></span><div><small>Paso 2</small><strong>Genera su código</strong><p>Seis cifras, personal. Solo se muestra una vez.</p></div></li><li><span className="path-icon"><Icon name="link" size={20}/></span><div><small>Paso 3</small><strong>Comparte el enlace</strong><p>Con el enlace de la sesión, entran con su correo y su código.</p></div></li></ol>
    </div>
    : <div className="people-layout">
      <div>
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Buscar por nombre o correo" label="Buscar personas"/>
          <div className="chips" role="group" aria-label="Filtrar por rol">{([['all', 'Todas'], ['participant', 'Participantes'], ['instructor', 'Docentes']] as const).map(([key, label]) => <button key={key} type="button" className="chip" aria-pressed={roleFilter === key} onClick={() => setRoleFilter(key)}>{label}</button>)}</div>
        </div>
        <div className="card table-card">
          {members === null ? <div className="table-wrap" aria-busy="true"><table className="table"><tbody>{[0, 1, 2].map(i => <tr key={i} aria-hidden="true"><td><Sk w={200} h={13}/><Sk w={160} h={10} className="sk-gap-s"/></td><td><Sk w={80} h={12}/></td><td><Sk w={120} h={12}/></td><td/></tr>)}</tbody></table></div>
          : rows.length === 0 ? <EmptyState icon="search" title="Sin resultados" action={<button className="btn" onClick={() => { setQuery(''); setRoleFilter('all'); }}>Limpiar filtros</button>}>Nadie coincide con la búsqueda.</EmptyState>
          : <div className="table-wrap"><table className="table">
            <caption className="sr-only">Personas de la organización</caption>
            <thead><tr><th scope="col">Persona</th><th scope="col" className="hide-sm">Rol</th><th scope="col">Código</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>{rows.map(member => {
              const code = codes.find(item => item.userId === member.id);
              const self = member.id === app.identity.id;
              const canManage = !self && (member.role === 'participant' || app.canAssignInstructor);
              const items: MenuItem[] = [
                { label: code ? 'Generar código nuevo' : 'Generar código', icon: 'key', onSelect: () => void issue(member), disabled: !codesAvailable, hint: 'No disponible en este entorno' },
                ...(code ? [{ label: 'Revocar código', icon: 'stop', onSelect: () => void revoke(member) } as MenuItem] : []),
                'separator',
                { label: 'Dar de baja', icon: 'trash', danger: true, onSelect: () => void remove(member) }
              ];
              return <tr key={member.id}>
                <th scope="row"><span className="person"><span className="avatar" aria-hidden="true">{initials(member.name)}</span><span className="person-text"><strong>{member.name}{self && <em className="tag-sim">Tú</em>}</strong><small>{member.email}</small></span></span></th>
                <td className="hide-sm">{roleLabel(member.role)}</td>
                <td>{code ? <span className="code-status"><span className="state-pill done">Activo</span><small>{plural(code.uses, 'acceso', 'accesos')}{code.lastUsedAt ? ` · ${relativeDate(code.lastUsedAt)}` : ''}</small></span> : <span className="code-status"><span className="state-pill">Sin código</span>{canManage && codesAvailable && <button className="link" onClick={() => void issue(member)}>Generar</button>}</span>}</td>
                <td className="menu-cell">{canManage && <ActionMenu label={`Acciones de ${member.name}`} items={items}/>}</td>
              </tr>;
            })}</tbody>
          </table></div>}
        </div>
      </div>
      <aside className="card audit-card" aria-labelledby="audit-title">
        <h2 id="audit-title" className="card-title">Últimos accesos</h2>
        {!codesAvailable ? <p className="empty-line">El registro de accesos no está disponible en este entorno.</p>
        : uses.length ? <ul className="audit-list">{uses.slice(0, 10).map((entry, index) => <li key={`${entry.codeId}-${entry.at}-${index}`}><span className={`audit-dot ${entry.outcome}`} aria-hidden="true"/><div><strong>{entry.name ?? 'Persona dada de baja'}</strong><small>{entry.outcome === 'accepted' ? 'Acceso correcto' : 'Intento con código revocado'} · {relativeDate(entry.at)}</small></div></li>)}</ul>
        : <p className="empty-line">Todavía no se ha usado ningún código. Cuando alguien entre, lo verás aquí.</p>}
        <p className="fine-print">Cada código es personal, se muestra una sola vez y puedes revocarlo cuando quieras.</p>
      </aside>
    </div>}

    {adding && <AddMemberDialog canAssignInstructor={app.canAssignInstructor} onClose={() => setAdding(false)} onAdded={(member, wantsCode) => {
      setMembers(current => [...(current ?? []).filter(item => item.id !== member.id), member].sort((a, b) => a.name.localeCompare(b.name, 'es')));
      setAdding(false);
      toast(`${member.name} se ha dado de alta`);
      if (wantsCode && codesAvailable) void issue(member);
    }}/>}
    {issued && <Modal title="Código de acceso" size="sm" onClose={() => setIssued(null)} footer={<button className="btn btn-primary" data-autofocus onClick={() => setIssued(null)}>Hecho</button>}>
      <p className="muted-text">Código personal de <strong>{issued.name}</strong> ({issued.email}).</p>
      <div className="issued"><strong className="tabular" aria-label={`Código ${issued.code.split('').join(' ')}`}>{issued.code}</strong><CopyButton text={issued.code} label="Copiar código" done="Código copiado" className="btn"/></div>
      <p className="modal-warn">Entrégalo por un canal privado. Por seguridad, no volverá a mostrarse.</p>
    </Modal>}
  </div>;
}

function AddMemberDialog({ canAssignInstructor, onClose, onAdded }: { canAssignInstructor: boolean; onClose: () => void; onAdded: (member: Member, wantsCode: boolean) => void }) {
  const app = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('participant');
  const [withCode, setWithCode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ids = { name: useId(), email: useId(), role: useId() };
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await app.api<{ member: Member }>('/memberships', { method: 'POST', body: JSON.stringify({ name: name.trim(), email: email.trim(), role }) });
      onAdded(result.member, withCode);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <Modal title="Dar de alta" description="La persona podrá entrar con su correo y el código personal que le entregues." onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <label className="field" htmlFor={ids.name}><span>Nombre y apellidos</span><input id={ids.name} data-autofocus value={name} onChange={event => setName(event.target.value)} maxLength={100} required autoComplete="off"/></label>
      <label className="field" htmlFor={ids.email}><span>Correo electrónico</span><input id={ids.email} type="email" placeholder="nombre@ufv.es" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required autoComplete="off"/></label>
      {canAssignInstructor && <label className="field" htmlFor={ids.role}><span>Rol</span><select id={ids.role} value={role} onChange={event => setRole(event.target.value as Role)}><option value="participant">Participante</option><option value="instructor">Docente</option></select></label>}
      <label className="check"><input type="checkbox" checked={withCode} onChange={event => setWithCode(event.target.checked)}/>Generar su código de acceso ahora</label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-foot inline"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy || !name.trim() || !email.trim()}>{busy ? 'Guardando…' : 'Dar de alta'}</button></div>
    </form>
  </Modal>;
}
