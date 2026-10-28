import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { api } from './api'
import { visitStatusLabel } from './format'
import type { Client, Lookups, Paged, Product, Stats, VisitStatus } from './types'

export function PageHead({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="btn-row">{actions}</div>}
    </header>
  )
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill st-${status}`}>{label ?? visitStatusLabel[status as VisitStatus] ?? status}</span>
}

export function ExecBar({ stats }: { stats: Stats }) {
  const total = Math.max(stats.total, 1)
  const pct = (n: number) => `${(n / total) * 100}%`
  return (
    <div
      className="execbar"
      role="img"
      aria-label={`${stats.done} feitos, ${stats.justified} justificados, ${stats.inProgress} em atendimento, ${stats.pending} não feitos`}
    >
      <span className="b-done" style={{ width: pct(stats.done) }} />
      <span className="b-just" style={{ width: pct(stats.justified) }} />
      <span className="b-prog" style={{ width: pct(stats.inProgress) }} />
      <span className="b-pend" style={{ width: pct(stats.pending) }} />
    </div>
  )
}

export function Loading({ text = 'Carregando…' }: { text?: string }) {
  return <div className="loading">{text}</div>
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null
  return <div className="alert">{error instanceof Error ? error.message : String(error)}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const titleId = useId()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="btn icon" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  return (
    <div className="pager">
      <span className="num">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}
      </span>
      <div className="btn-row">
        <button className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </button>
        <button className="btn small" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Próxima
        </button>
      </div>
    </div>
  )
}

export function useLookups() {
  return useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/admin/lookups'), staleTime: 60_000 })
}

export function PromotorSelect({ value, onChange, allLabel = 'Todos os promotores' }: { value: string; onChange: (v: string) => void; allLabel?: string }) {
  const { data } = useLookups()
  return (
    <Field label="Promotor">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {data?.promotores.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void }) {
  return (
    <>
      <Field label="De">
        <input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to })} />
      </Field>
      <Field label="Até">
        <input className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && onChange({ from, to: e.target.value })} />
      </Field>
    </>
  )
}

/** Campo de busca de produto do catálogo. */
export function ProductPicker({ onPick, exclude = [] }: { onPick: (p: Product) => void; exclude?: string[] }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [debounced, setDebounced] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const { data } = useQuery({
    queryKey: ['product-search', debounced],
    queryFn: () => api<Paged<Product>>('/admin/products', { query: { search: debounced, active: true, pageSize: 30 } }),
    enabled: open,
  })
  const items = data?.items.filter((p) => !exclude.includes(p.id)) ?? []
  return (
    <div className="picker" ref={ref}>
      <input
        className="input"
        style={{ width: '100%' }}
        value={search}
        placeholder="Adicionar produto: nome, código ou marca"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setSearch(e.target.value)
          setOpen(true)
        }}
      />
      {open && (
        <div className="picker-list">
          {items.length === 0 && <div className="muted small" style={{ padding: 10 }}>Nenhum produto encontrado.</div>}
          {items.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onPick(p)
                setSearch('')
              }}
            >
              <strong>{p.code} · {p.name}</strong>
              {p.category && <span className="muted"> {p.category}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Campo de busca de cliente com lista de resultados. */
export function ClientPicker({ onPick, placeholder = 'Buscar cliente por nome, código ou cidade', exclude = [] }: { onPick: (c: Client) => void; placeholder?: string; exclude?: string[] }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [debounced, setDebounced] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const { data } = useQuery({
    queryKey: ['client-search', debounced],
    queryFn: () => api<Paged<Client>>('/admin/clients', { query: { search: debounced, active: true, pageSize: 20 } }),
    enabled: open,
  })
  const items = data?.items.filter((c) => !exclude.includes(c.id)) ?? []
  return (
    <div className="picker" ref={ref}>
      <input
        className="input"
        style={{ width: '100%' }}
        value={search}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setSearch(e.target.value)
          setOpen(true)
        }}
      />
      {open && (
        <div className="picker-list">
          {items.length === 0 && <div className="muted small" style={{ padding: 10 }}>Nenhum cliente encontrado.</div>}
          {items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onPick(c)
                setSearch('')
                setOpen(false)
              }}
            >
              <strong>{c.code ? `${c.code} · ` : ''}{c.name}</strong>
              <span className="muted"> {c.city ?? ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
