/**
 * Componentes de interfaz de la consola: diálogos accesibles (confirmación y texto), menú de acciones, cabeceras de
 * página, migas, pastillas de estado, estados vacíos e iconos. Sin dependencias externas.
 */
import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from './router';
import { statusLabel } from './types';

/* ---------- Iconos (trazo de 1,75 px, heredan el color) ---------- */

const paths: Record<string, React.ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/></>,
  sessions: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h3M8 17h6"/></>,
  scenarios: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></>,
  people: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  more: <><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></>,
  menu: <path d="M3 6h18M3 12h18M3 18h18"/>,
  close: <path d="M6 6l12 12M18 6 6 18"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
  project: <><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></>,
  pause: <path d="M9 5v14M15 5v14"/>,
  play: <path d="M7 4.5v15l12-7.5z"/>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1"/>,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></>,
  report: <><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></>,
  download: <><path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 20h16"/></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/></>,
  next: <path d="M5 12h14M13 6l6 6-6 6"/>,
  back: <path d="M19 12H5M11 6l-6 6 6 6"/>,
  key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/></>,
  users: <><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6"/></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5"/>,
  external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/></>,
  sim: <><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h7M12 8.5v7"/></>,
  logout: <><path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/></>,
  clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></>,
  chart: <><path d="M4 4v16h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/></>,
  sparkles: <><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4-5.7-1.8L10.2 9z"/><path d="M19 3v4M17 5h4M5 17v3M3.5 18.5h3"/></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/></>,
  doc: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></>
};

export function Icon({ name, size = 18, className = '' }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

/* ---------- Piezas de página ---------- */

export function PageHeader({ title, description, actions, crumbs, eyebrow, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; crumbs?: { label: string; to?: string }[]; eyebrow?: React.ReactNode; children?: React.ReactNode }) {
  return <header className="page-header">
    {crumbs && <Breadcrumbs items={crumbs}/>}
    <div className="page-header-row">
      <div className="page-header-text">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 tabIndex={-1} data-page-title>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
    {children}
  </header>;
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return <nav className="crumbs" aria-label="Ruta de navegación"><ol>
    {items.map((item, i) => <li key={`${item.label}-${i}`}>{item.to && i < items.length - 1 ? <Link to={item.to}>{item.label}</Link> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{item.label}</span>}</li>)}
  </ol></nav>;
}

export function StatusPill({ status, className = '' }: { status: string; className?: string }) {
  const tone = status === 'complete' ? 'complete' : status === 'paused' ? 'paused' : 'active';
  return <span className={`pill pill-${tone} ${className}`}><i aria-hidden="true"/>{statusLabel(status)}</span>;
}

export function EmptyState({ icon = 'sessions', title, children, action }: { icon?: string; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty-block"><span className="empty-icon"><Icon name={icon} size={22}/></span><h3>{title}</h3>{children && <p>{children}</p>}{action && <div className="empty-actions">{action}</div>}</div>;
}

/* ---------- Diálogos ---------- */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Diálogo modal: atrapa el foco, se cierra con Esc o clic fuera y devuelve el foco a quien lo abrió. */
export function Modal({ title, description, onClose, children, footer, tone, size = 'md', initialFocus }: { title: string; description?: React.ReactNode; onClose: () => void; children?: React.ReactNode; footer?: React.ReactNode; tone?: 'danger'; size?: 'sm' | 'md' | 'lg'; initialFocus?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = box.current!;
    const first = (initialFocus && node.querySelector<HTMLElement>(initialFocus)) || node.querySelector<HTMLElement>('[data-autofocus]') || node.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    document.body.classList.add('no-scroll');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(item => item.offsetParent !== null);
      if (!items.length) { event.preventDefault(); return; }
      const [head, tail] = [items[0], items[items.length - 1]];
      if (event.shiftKey && document.activeElement === head) { event.preventDefault(); tail.focus(); }
      else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head.focus(); }
    };
    node.addEventListener('keydown', onKey);
    return () => { node.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); opener?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={box} className={`modal modal-${size} ${tone ? `modal-${tone}` : ''}`} role={tone === 'danger' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined}>
      <div className="modal-head"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar"><Icon name="close"/></button></div>
      {description && <div className="modal-desc" id={descId}>{description}</div>}
      {children && <div className="modal-body">{children}</div>}
      {footer && <div className="modal-foot">{footer}</div>}
    </div>
  </div>;
}

type ConfirmOptions = { title: string; body: React.ReactNode; confirmLabel: string; cancelLabel?: string; tone?: 'danger' };
type PromptOptions = { title: string; label: string; initial?: string; placeholder?: string; maxLength?: number; confirmLabel?: string; hint?: string; required?: boolean };
type DialogApi = { confirm: (options: ConfirmOptions) => Promise<boolean>; prompt: (options: PromptOptions) => Promise<string | null> };
const DialogContext = createContext<DialogApi>({ confirm: async () => false, prompt: async () => null });
export const useDialogs = () => useContext(DialogContext);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<{ kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void } | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void } | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => setCurrent({ kind: 'confirm', options, resolve })), []);
  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>(resolve => setCurrent({ kind: 'prompt', options, resolve })), []);
  const api = useRef<DialogApi>({ confirm, prompt }).current;
  return <DialogContext.Provider value={api}>
    {children}
    {current?.kind === 'confirm' && <Modal title={current.options.title} tone={current.options.tone} size="sm" description={current.options.body} initialFocus="[data-cancel]"
      onClose={() => { current.resolve(false); setCurrent(null); }}
      footer={<><button type="button" className="btn" data-cancel onClick={() => { current.resolve(false); setCurrent(null); }}>{current.options.cancelLabel ?? 'Cancelar'}</button>
        <button type="button" className={`btn ${current.options.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={() => { current.resolve(true); setCurrent(null); }}>{current.options.confirmLabel}</button></>}/>}
    {current?.kind === 'prompt' && <PromptDialog options={current.options} onDone={value => { current.resolve(value); setCurrent(null); }}/>}
  </DialogContext.Provider>;
}

function PromptDialog({ options, onDone }: { options: PromptOptions; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(options.initial ?? '');
  const id = useId();
  const max = options.maxLength ?? 80;
  const trimmed = value.trim();
  const valid = options.required === false || trimmed.length > 0;
  return <Modal title={options.title} size="sm" onClose={() => onDone(null)}>
    <form onSubmit={event => { event.preventDefault(); if (valid) onDone(trimmed); }} className="form-stack">
      <label className="field" htmlFor={id}><span>{options.label}</span>
        <input id={id} data-autofocus value={value} maxLength={max} placeholder={options.placeholder} onChange={event => setValue(event.target.value)} onFocus={event => event.currentTarget.select()}/></label>
      <div className="field-meta"><small>{options.hint ?? ''}</small><small className="tabular">{value.length}/{max}</small></div>
      <div className="modal-foot inline"><button type="button" className="btn" onClick={() => onDone(null)}>Cancelar</button><button className="btn btn-primary" disabled={!valid}>{options.confirmLabel ?? 'Guardar'}</button></div>
    </form>
  </Modal>;
}

/* ---------- Menú de acciones (botón «…») ---------- */

export type MenuItem = { label: string; icon?: string; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string; className?: string } | 'separator';

/**
 * Menú desplegable accesible: flechas, Inicio/Fin, Esc y Tab. Se posiciona con `position: fixed` para no quedar
 * recortado por tablas con desplazamiento; se abre hacia arriba si no cabe debajo.
 */
export function ActionMenu({ items, label = 'Más acciones', buttonLabel, className = '', icon = 'more' }: { items: MenuItem[]; label?: string; buttonLabel?: React.ReactNode; className?: string; icon?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties>({});
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((focusButton = true) => { setOpen(false); if (focusButton) button.current?.focus(); }, []);

  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const rect = button.current.getBoundingClientRect();
    const height = menu.current.offsetHeight;
    const width = menu.current.offsetWidth;
    const below = window.innerHeight - rect.bottom;
    const top = below < height + 12 && rect.top > height + 12 ? rect.top - height - 6 : rect.bottom + 6;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    setPosition({ top, left });
    [...menu.current.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])')].find(item => item.offsetParent !== null)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) close(false); };
    const onScroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
  }, [open, close]);

  function onKeyDown(event: React.KeyboardEvent) {
    const entries = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? [])].filter(item => item.offsetParent !== null);
    const index = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); entries[(index + 1) % entries.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); entries[(index - 1 + entries.length) % entries.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); entries[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); entries[entries.length - 1]?.focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') close(false);
  }

  return <>
    <button ref={button} type="button" className={`${buttonLabel ? 'btn' : 'icon-button'} menu-trigger ${className}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={buttonLabel ? undefined : label} title={buttonLabel ? undefined : label}
      onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); } }}>
      {buttonLabel ? <>{buttonLabel}<Icon name={icon} size={16}/></> : <Icon name={icon}/>}
    </button>
    {open && createPortal(<div ref={menu} id={menuId} className="menu" role="menu" aria-label={label} style={{ position: 'fixed', ...position }} onKeyDown={onKeyDown}>
      {items.map((item, i) => item === 'separator'
        ? <div key={`sep-${i}`} className="menu-sep" role="separator"/>
        : <button key={item.label} type="button" role="menuitem" tabIndex={-1} className={`menu-item ${item.danger ? 'danger' : ''} ${item.className ?? ''}`} aria-disabled={item.disabled || undefined} title={item.disabled ? item.hint : undefined}
            onClick={() => { if (item.disabled) return; close(); item.onSelect(); }}>
            {item.icon && <Icon name={item.icon} size={16}/>}<span>{item.label}</span>
          </button>)}
    </div>, document.body)}
  </>;
}

/** Campo de búsqueda con icono y botón de limpiar. */
export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return <div className="search-field"><Icon name="search" size={16}/><input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)}/>{value && <button type="button" className="icon-button" aria-label="Limpiar búsqueda" onClick={() => onChange('')}><Icon name="close" size={14}/></button>}</div>;
}
