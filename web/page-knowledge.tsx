/**
 * Modo IA en vivo · demo (solo docentes con la bandera `ai_live_demo`): colecciones de conocimiento con
 * documentos propios (PDF, DOCX, TXT, MD o texto pegado) a partir de los cuales VictorIA genera situaciones.
 * Separado del catálogo de escenarios publicados: no cambia sesiones, informes ni analítica.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useApp, type ApiError } from './app-context';
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES, mimeFor, type AiRun, type AiRunListItem, type KnowledgeCollection, type KnowledgeDocument } from './ai-live-types';
import { EmptyState, Icon, Modal, PageHeader, useDialogs } from './kit';
import { Link, navigate, setQuery, useLocation } from './router';
import { errorText, plural } from './types';
import { Sk, useToast } from './ui';
import './ai-live.css';

/** Pestañas de Escenarios: catálogo publicado y modo IA en vivo (solo si la bandera está activa). */
export function ScenarioTabs({ current }: { current: 'catalog' | 'ai' }) {
  return <nav className="tabs scenario-tabs" aria-label="Tipo de escenarios">
    <Link className="tab" to="/escenarios" aria-current={current === 'catalog' ? 'page' : undefined}><Icon name="scenarios" size={16}/>Catálogo</Link>
    <Link className="tab" to="/escenarios/ia" aria-current={current === 'ai' ? 'page' : undefined}><Icon name="sparkles" size={16}/>Modo IA en vivo · demo</Link>
  </nav>;
}

const unavailable = (cause: unknown) => [404, 405, 501].includes((cause as ApiError).status ?? 0);
const kb = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('es-ES')} KB`;

type Upload = { key: string; name: string; status: 'reading' | 'uploading' | 'processing' | 'ready' | 'error'; message?: string };

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const value = String(reader.result ?? ''); resolve(value.slice(value.indexOf(',') + 1)); };
    reader.onerror = () => reject(new Error('No se ha podido leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

export function KnowledgePage() {
  const app = useApp();
  const toast = useToast();
  const { confirm, prompt } = useDialogs();
  const { query } = useLocation();
  const [collections, setCollections] = useState<KnowledgeCollection[] | null>(null);
  const [offline, setOffline] = useState('');
  const selectedId = query.get('coleccion');
  const selected = collections?.find(item => item.id === selectedId) ?? collections?.[0] ?? null;

  const load = useCallback(async () => {
    try { const result = await app.api<{ collections: KnowledgeCollection[] }>('/knowledge/collections'); setCollections(result.collections ?? []); setOffline(''); }
    catch (cause) { setCollections([]); setOffline(unavailable(cause) ? 'El modo IA en vivo aún no está disponible en este servidor.' : errorText(cause)); }
  }, [app.api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { document.title = 'Modo IA en vivo · Escenarios'; }, []);

  async function create() {
    const name = await prompt({ title: 'Nueva colección de conocimiento', label: 'Nombre', placeholder: 'Ej.: Guía de IA en la docencia', maxLength: 80, confirmLabel: 'Crear colección', hint: 'Agrupa los documentos de un mismo tema.' });
    if (!name) return;
    try {
      const result = await app.api<{ collection: KnowledgeCollection }>('/knowledge/collections', { method: 'POST', body: JSON.stringify({ name }) });
      setCollections(current => [result.collection, ...(current ?? []).filter(item => item.id !== result.collection.id)]);
      setQuery({ coleccion: result.collection.id }, { replace: true });
      toast('Colección creada. Ahora añade documentos.');
    } catch (cause) { toast(unavailable(cause) ? 'El modo IA en vivo aún no está disponible en este servidor.' : `No se ha podido crear: ${errorText(cause)}`, 'error'); }
  }

  async function remove(collection: KnowledgeCollection) {
    const ok = await confirm({ title: '¿Eliminar la colección?', tone: 'danger', confirmLabel: 'Eliminar colección', body: <><p>Se eliminará «{collection.name}» con {plural(collection.documentCount, 'documento', 'documentos')} y su índice.</p><p className="modal-warn">No se puede deshacer.</p></> });
    if (!ok) return;
    try {
      await app.api(`/knowledge/collections/${encodeURIComponent(collection.id)}`, { method: 'DELETE' });
      setCollections(current => current?.filter(item => item.id !== collection.id) ?? current);
      if (selectedId === collection.id) setQuery({ coleccion: null }, { replace: true });
      toast('Colección eliminada');
    } catch (cause) { toast(`No se ha podido eliminar: ${errorText(cause)}`, 'error'); }
  }

  const patchCollection = useCallback((id: string, patch: Partial<KnowledgeCollection>) => setCollections(current => current?.map(item => item.id === id ? { ...item, ...patch } : item) ?? current), []);

  return <div className="page knowledge-page">
    <PageHeader title="Escenarios" description="Situaciones de aprendizaje listas para usar o generadas en directo por VictorIA a partir de tus documentos."
      actions={<button className="btn" onClick={create}><Icon name="plus" size={16}/>Nueva colección</button>}/>
    <ScenarioTabs current="ai"/>
    <div className="ai-notice" role="note"><Icon name="sparkles" size={18}/><div><strong>Demostración con IA generativa.</strong> No subas datos personales. El contenido se procesa con IA en Cloudflare; la voz, con Soniox (EE. UU.). Las situaciones se generan a partir de tus documentos y pueden contener errores: revísalas antes de usarlas en clase.</div></div>
    {offline && <div className="error" role="alert">{offline}</div>}
    {collections === null ? <div className="kb-layout" aria-busy="true"><div className="card kb-list"><Sk w="70%" h={14}/><Sk w="90%" h={12} className="sk-gap"/><Sk w="60%" h={12} className="sk-gap"/></div><div className="card kb-detail"><Sk w="40%" h={22}/><Sk w="100%" h={120} className="sk-gap"/></div></div>
    : collections.length === 0 ? <div className="card"><EmptyState icon="sparkles" title="Crea tu primera colección de conocimiento" action={<button className="btn btn-primary" onClick={create} disabled={!!offline && !app.standalone}><Icon name="plus" size={16}/>Nueva colección</button>}>Sube guías, normativas o apuntes. VictorIA generará situaciones de decisión con ellos y las conducirá por voz, citando las fuentes.</EmptyState></div>
    : <div className="kb-layout">
        <nav className="card kb-list" aria-label="Colecciones">
          <div className="kb-list-head"><span className="eyebrow">Colecciones</span><span className="tab-count">{collections.length}</span></div>
          <ul>{collections.map(item => <li key={item.id}>
            <Link to={`/escenarios/ia?coleccion=${encodeURIComponent(item.id)}`} className="kb-item" aria-current={selected?.id === item.id ? 'true' : undefined}>
              <strong>{item.name}</strong><small>{plural(item.documentCount, 'documento', 'documentos')}{item.chunkCount ? ` · ${plural(item.chunkCount, 'fragmento', 'fragmentos')}` : ''}</small>
            </Link></li>)}</ul>
          <button className="btn btn-quiet btn-sm kb-new" onClick={create}><Icon name="plus" size={14}/>Nueva colección</button>
        </nav>
        {selected && <CollectionDetail key={selected.id} collection={selected} onRemove={() => void remove(selected)} onChange={patch => patchCollection(selected.id, patch)}/>}
      </div>}
  </div>;
}

function CollectionDetail({ collection, onRemove, onChange }: { collection: KnowledgeCollection; onRemove: () => void; onChange: (patch: Partial<KnowledgeCollection>) => void }) {
  const app = useApp();
  const toast = useToast();
  const { confirm } = useDialogs();
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [starting, setStarting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const base = `/knowledge/collections/${encodeURIComponent(collection.id)}/documents`;

  const load = useCallback(async () => {
    try { const result = await app.api<{ documents: KnowledgeDocument[] }>(base); setDocuments(result.documents ?? []); return result.documents ?? []; }
    catch { setDocuments(current => current ?? []); return null; }
  }, [app.api, base]);
  useEffect(() => { void load(); }, [load]);
  // Mientras haya documentos procesándose, se consulta cada 2 s.
  const processing = (documents ?? []).some(item => item.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [processing, load]);
  useEffect(() => {
    if (documents && documents.length !== collection.documentCount) onChange({ documentCount: documents.length });
  }, [documents]);

  const setUpload = (key: string, patch: Partial<Upload>) => setUploads(current => current.map(item => item.key === key ? { ...item, ...patch } : item));

  async function send(name: string, payload: Record<string, unknown>, key: string) {
    setUpload(key, { status: 'uploading' });
    try {
      const result = await app.api<{ document: KnowledgeDocument }>(base, { method: 'POST', body: JSON.stringify({ name, ...payload }) });
      const document = result.document;
      setDocuments(current => [document, ...(current ?? []).filter(item => item.id !== document.id)]);
      if (document.status === 'error') setUpload(key, { status: 'error', message: document.error || 'No se ha podido procesar.' });
      else if (document.status === 'processing') setUpload(key, { status: 'processing' });
      else { setUpload(key, { status: 'ready', message: `${document.chars.toLocaleString('es-ES')} caracteres` }); window.setTimeout(() => setUploads(current => current.filter(item => item.key !== key)), 4000); }
      void load();
    } catch (cause) {
      setUpload(key, { status: 'error', message: (cause as ApiError).status === 413 ? 'El archivo es demasiado grande para el servidor.' : errorText(cause) });
    }
  }

  async function addFiles(list: FileList | File[]) {
    for (const file of [...list]) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`;
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
      if (!ACCEPTED_EXTENSIONS.includes(ext)) { setUploads(current => [...current, { key, name: file.name, status: 'error', message: 'Formato no admitido. Usa PDF, DOCX, TXT o MD.' }]); continue; }
      if (file.size > MAX_UPLOAD_BYTES) { setUploads(current => [...current, { key, name: file.name, status: 'error', message: `Supera el límite de 20 MB (${kb(file.size)}).` }]); continue; }
      setUploads(current => [...current, { key, name: file.name, status: 'reading' }]);
      try { const dataBase64 = await readBase64(file); await send(file.name, { mime: mimeFor(file), dataBase64 }, key); }
      catch (cause) { setUpload(key, { status: 'error', message: errorText(cause) }); }
    }
  }

  // Al terminar el procesamiento en el servidor, la subida pendiente se marca como lista o con error.
  useEffect(() => {
    if (!documents) return;
    setUploads(current => current.map(item => {
      if (item.status !== 'processing') return item;
      const doc = documents.find(entry => entry.name === item.name);
      if (!doc || doc.status === 'processing') return item;
      return doc.status === 'error' ? { ...item, status: 'error', message: doc.error || 'No se ha podido procesar.' } : { ...item, status: 'ready', message: `${doc.chars.toLocaleString('es-ES')} caracteres` };
    }));
  }, [documents]);

  async function removeDocument(document: KnowledgeDocument) {
    const ok = await confirm({ title: '¿Quitar el documento?', tone: 'danger', confirmLabel: 'Quitar', body: <p>«{document.name}» dejará de usarse para generar situaciones.</p> });
    if (!ok) return;
    try { await app.api(`/knowledge/documents/${encodeURIComponent(document.id)}`, { method: 'DELETE' }); setDocuments(current => current?.filter(item => item.id !== document.id) ?? current); toast('Documento quitado'); }
    catch (cause) { toast(`No se ha podido quitar: ${errorText(cause)}`, 'error'); }
  }

  const ready = (documents ?? []).filter(item => item.status === 'ready');
  const busy = uploads.some(item => item.status === 'reading' || item.status === 'uploading');

  return <section className="card kb-detail" aria-labelledby="kb-title">
    <div className="kb-detail-head">
      <div><span className="eyebrow">Colección</span><h2 id="kb-title">{collection.name}</h2><p className="kb-meta">{plural(documents?.length ?? collection.documentCount, 'documento', 'documentos')} · {plural(ready.length, 'listo', 'listos')}</p></div>
      <div className="kb-detail-actions">
        <button className="btn btn-danger-quiet btn-sm" onClick={onRemove}><Icon name="trash" size={14}/>Eliminar</button>
        <button className="btn btn-primary btn-lg ai-cta" disabled={!ready.length || processing} onClick={() => setStarting(true)} title={!ready.length ? 'Añade al menos un documento listo' : undefined}><Icon name="sparkles" size={18}/>Iniciar simulación con IA</button>
      </div>
    </div>

    <div className={`dropzone ${dragging ? 'over' : ''}`}
      onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files); }}>
      <Icon name="upload" size={26}/>
      <p><strong>Arrastra aquí tus documentos</strong><br/>PDF, DOCX, TXT o MD · hasta 20 MB cada uno</p>
      <div className="dropzone-actions">
        <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy}><Icon name="upload" size={16}/>Elegir archivos</button>
        <button type="button" className="btn" onClick={() => setPasting(true)}><Icon name="edit" size={16}/>Pegar texto</button>
      </div>
      <input ref={input} type="file" hidden multiple accept={[...ACCEPTED_EXTENSIONS, 'application/pdf', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].join(',')} onChange={event => { if (event.target.files?.length) void addFiles(event.target.files); event.target.value = ''; }}/>
    </div>

    {uploads.length > 0 && <ul className="upload-list" aria-live="polite">{uploads.map(item => <li key={item.key} className={`upload ${item.status}`}>
      <Icon name={item.status === 'error' ? 'close' : item.status === 'ready' ? 'check' : 'doc'} size={16}/>
      <span className="upload-name">{item.name}</span>
      <span className="upload-status">{({ reading: 'Leyendo…', uploading: 'Subiendo…', processing: 'Procesando con IA…', ready: 'Listo', error: 'Error' } as const)[item.status]}{item.message ? ` · ${item.message}` : ''}</span>
      {(item.status === 'reading' || item.status === 'uploading' || item.status === 'processing') ? <span className="upload-bar" aria-hidden="true"/> : <button className="icon-button" aria-label={`Ocultar ${item.name}`} onClick={() => setUploads(current => current.filter(entry => entry.key !== item.key))}><Icon name="close" size={14}/></button>}
    </li>)}</ul>}

    <h3 className="kb-subtitle">Documentos</h3>
    {documents === null ? <div><Sk w="100%" h={44}/><Sk w="100%" h={44} className="sk-gap"/></div>
    : documents.length === 0 ? <p className="kb-empty">Aún no hay documentos. Sube al menos uno para poder generar situaciones.</p>
    : <ul className="doc-list">{documents.map(item => <li key={item.id} className="doc-row">
        <span className="doc-icon" aria-hidden="true"><Icon name="doc" size={18}/></span>
        <div className="doc-text"><strong>{item.name}</strong><small>{item.chars ? `${item.chars.toLocaleString('es-ES')} caracteres` : '—'}{item.bytes ? ` · ${kb(item.bytes)}` : ''}</small>{item.status === 'error' && item.error && <small className="doc-error">{item.error}</small>}</div>
        <span className={`doc-status ${item.status}`}>{item.status === 'ready' ? 'Listo' : item.status === 'processing' ? 'Procesando…' : 'Error'}</span>
        <button className="icon-button" aria-label={`Quitar ${item.name}`} title="Quitar" onClick={() => void removeDocument(item)}><Icon name="trash" size={16}/></button>
      </li>)}</ul>}

    <RecentRuns collectionId={collection.id}/>

    {pasting && <PasteDialog onClose={() => setPasting(false)} onSubmit={(name, text) => { setPasting(false); const key = `paste-${Date.now()}`; setUploads(current => [...current, { key, name, status: 'uploading' }]); void send(name, { text }, key); }}/>}
    {starting && <StartDialog collection={collection} onClose={() => setStarting(false)}/>}
  </section>;
}

/** Partidas recientes de la colección: continuar o convertir las situaciones generadas en un escenario para clase. */
function RecentRuns({ collectionId }: { collectionId: string }) {
  const app = useApp();
  const [runs, setRuns] = useState<AiRunListItem[] | null>(null);
  useEffect(() => {
    let stop = false;
    void app.api<{ runs: AiRunListItem[] }>(`/ai-runs?collectionId=${encodeURIComponent(collectionId)}`).then(result => { if (!stop) setRuns(result.runs ?? []); }).catch(() => { if (!stop) setRuns([]); });
    return () => { stop = true; };
  }, [app.api, collectionId]);
  if (!runs?.length) return null;
  return <>
    <h3 className="kb-subtitle">Partidas recientes</h3>
    <p className="kb-runs-hint">Convierte una partida en un escenario para clase: revisarás y editarás cada situación antes de publicarla.</p>
    <ul className="doc-list kb-runs">{runs.map(run => {
      const done = run.status === 'complete';
      const enough = run.generated >= 2;
      return <li key={run.id} className="doc-row">
        <span className="doc-icon" aria-hidden="true"><Icon name="sparkles" size={18}/></span>
        <div className="doc-text"><strong>{run.focus || 'Sin enfoque concreto'}</strong>
          <small>{new Date(run.createdAt).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {done ? `Terminada · ${plural(run.generated, 'situación', 'situaciones')}` : `En curso · ${run.generated} de ${run.situationsTotal} situaciones generadas`}</small></div>
        <div className="kb-run-actions">
          {!done && <Link className="btn btn-sm" to={`/ia/${encodeURIComponent(run.id)}`}>Continuar</Link>}
          <button className="btn btn-primary btn-sm" disabled={!enough} title={enough ? undefined : 'Hacen falta al menos 2 situaciones generadas'} onClick={() => navigate(`/escenarios/borrador/${encodeURIComponent(run.id)}`)}><Icon name="scenarios" size={14}/>Convertir en escenario para clase</button>
        </div>
      </li>;
    })}</ul>
  </>;
}

function PasteDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string, text: string) => void }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const nameId = useId(); const textId = useId();
  const valid = name.trim().length > 0 && text.trim().length >= 20;
  return <Modal title="Pegar texto" size="lg" onClose={onClose} description="Pega el contenido de una guía, normativa o apuntes. No incluyas datos personales.">
    <form className="form-stack" onSubmit={event => { event.preventDefault(); if (valid) onSubmit(name.trim(), text.trim()); }}>
      <label className="field" htmlFor={nameId}><span>Título</span><input id={nameId} data-autofocus value={name} maxLength={120} placeholder="Ej.: Política de uso de IA" onChange={event => setName(event.target.value)}/></label>
      <label className="field" htmlFor={textId}><span>Texto</span><textarea id={textId} className="paste-area" value={text} rows={12} maxLength={400000} onChange={event => setText(event.target.value)}/></label>
      <div className="field-meta"><small>Mínimo 20 caracteres.</small><small className="tabular">{text.length.toLocaleString('es-ES')} caracteres</small></div>
      <div className="modal-foot inline"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!valid}>Añadir texto</button></div>
    </form>
  </Modal>;
}

function StartDialog({ collection, onClose }: { collection: KnowledgeCollection; onClose: () => void }) {
  const app = useApp();
  const [situations, setSituations] = useState(4);
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const focusId = useId();
  async function start(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await app.api<{ run: AiRun }>('/ai-runs', { method: 'POST', body: JSON.stringify({ collectionId: collection.id, situations, focus: focus.trim() || undefined }) });
      navigate(`/ia/${encodeURIComponent(result.run.id)}`);
    } catch (cause) { setBusy(false); setError(unavailable(cause) ? 'La simulación con IA aún no está disponible en este servidor.' : errorText(cause)); }
  }
  return <Modal title="Iniciar simulación con IA" onClose={onClose} description={<>VictorIA generará situaciones de decisión a partir de «{collection.name}» y las conducirá por voz. Necesitarás altavoces y micrófono.</>}>
    <form className="form-stack" onSubmit={start}>
      <fieldset className="seg-field"><legend>Número de situaciones</legend>
        <div className="seg" role="radiogroup">{[3, 4, 5, 6].map(value => <label key={value} className={situations === value ? 'on' : ''}><input type="radio" name="situaciones" value={value} checked={situations === value} onChange={() => setSituations(value)}/>{value}</label>)}</div>
      </fieldset>
      <label className="field" htmlFor={focusId}><span>Enfoque (opcional)</span><textarea id={focusId} className="paste-area short" rows={3} maxLength={200} value={focus} placeholder="Ej.: evaluación de trabajos, protección de datos…" onChange={event => setFocus(event.target.value)}/></label>
      <p className="ai-fine">Contenido generado con IA a partir de tus documentos; puede contener errores. La valoración es de cada decisión, nunca de la persona.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-foot inline"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy}><Icon name="sparkles" size={16}/>{busy ? 'Preparando…' : 'Empezar'}</button></div>
    </form>
  </Modal>;
}
