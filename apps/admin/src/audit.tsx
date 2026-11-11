import { useEffect, useRef } from 'react'
import { auditLabel, MIN_JUSTIFICATION, verdictLabel } from './audit-labels'
import { fmtDate, fmtDateTime } from './format'
import type { PhotoAuditInfo, ProductRef } from './types'
import { StatusPill } from './ui'

const metaLabels: Record<string, string> = {
  produto: 'Produto',
  validade: 'Validade',
  quantidade: 'Quantidade',
  avisoIntervaloCurto: 'Aviso de foto rápida',
  minutosAposAntes: 'Minutos após a foto de antes',
}

function metaValue(key: string, value: unknown) {
  if (key === 'validade') return fmtDate(String(value))
  if (key === 'avisoIntervaloCurto') return value ? 'o app avisou e o promotor confirmou que é de depois' : 'não'
  if (key === 'minutosAposAntes') return `${String(value).replace('.', ',')} min`
  return String(value)
}

/** Dados da foto ao lado da imagem: cliente, promotor, horário e o que o promotor informou. */
export function PhotoFacts({
  client,
  promotor,
  takenAt,
  task,
  meta,
  notes,
  products,
}: {
  client: { name: string; city: string | null }
  promotor: { name: string }
  takenAt: string
  task?: { title: string } | null
  meta: Record<string, unknown> | null
  notes: string | null
  products?: ProductRef[]
}) {
  return (
    <dl className="kv">
      <dt>Cliente</dt>
      <dd>
        {client.name}
        {client.city ? `, ${client.city}` : ''}
      </dd>
      <dt>Promotor</dt>
      <dd>{promotor.name}</dd>
      <dt>Tirada em</dt>
      <dd>{fmtDateTime(takenAt)}</dd>
      {task && (
        <>
          <dt>Atividade</dt>
          <dd>{task.title}</dd>
        </>
      )}
      {Object.entries(meta ?? {}).map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{metaLabels[k] ?? k}</dt>
          <dd className={k === 'avisoIntervaloCurto' ? 'texto-erro' : undefined}>{metaValue(k, v)}</dd>
        </div>
      ))}
      {notes && (
        <>
          <dt>Observação</dt>
          <dd>{notes}</dd>
        </>
      )}
      {!!products?.length && (
        <>
          <dt>Produtos na foto</dt>
          <dd>{products.map((p) => p.name).join(', ')}</dd>
        </>
      )}
    </dl>
  )
}

const roleLabel: Record<string, string> = { VENDEDOR: 'vendedor', SUPERVISOR: 'supervisor', ADMIN: 'administrador' }

/** Aprovações e reprovações já feitas na foto, com a conferência do supervisor nas dos vendedores. */
export function AuditList({ audits, title = 'Auditorias' }: { audits: PhotoAuditInfo[]; title?: string }) {
  if (audits.length === 0) return null
  return (
    <div className="stack" style={{ gap: 'var(--esp-2)' }}>
      <h3>{title}</h3>
      {audits.map((a) => (
        <div key={a.id} className="small">
          <StatusPill status={a.status} label={auditLabel[a.status]} /> por {a.auditor.name} ({roleLabel[a.auditor.role] ?? a.auditor.role}), {fmtDateTime(a.updatedAt)}
          {a.justification && <div className="muted">"{a.justification}"</div>}
          {a.review && (
            <div>
              Conferida por {a.review.supervisor.name}: <StatusPill status={a.review.verdict} label={verdictLabel[a.review.verdict].toLowerCase()} />
              {a.review.comment && <span className="muted"> {a.review.comment}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** Caixa da justificativa obrigatória. Ctrl+Enter confirma. */
export function JustificationBox({
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder?: string
  hint?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const length = value.trim().length
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        ref={ref}
        className="input"
        rows={3}
        value={value}
        maxLength={1000}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && length >= MIN_JUSTIFICATION) {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder={placeholder}
      />
      <span className="muted small" style={{ fontWeight: 400 }}>
        {length < MIN_JUSTIFICATION ? `Mínimo de ${MIN_JUSTIFICATION} caracteres (faltam ${MIN_JUSTIFICATION - length}).` : 'Ctrl+Enter confirma.'}
        {hint ? ` ${hint}` : ''}
      </span>
    </label>
  )
}
