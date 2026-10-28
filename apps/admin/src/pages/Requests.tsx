import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api'
import { addDays, fmtDate, fmtDateTime, requestStatusLabel, today } from '../format'
import type { PermissionRequest, RequestStatus } from '../types'
import { DateRange, Empty, ErrorBox, Field, Loading, Modal, PageHead, PromotorSelect, StatusPill } from '../ui'

function PayloadText({ r }: { r: PermissionRequest }) {
  const p = r.payload ?? {}
  if (r.type === 'ALTERAR_ORDEM' && Array.isArray(p.to)) {
    return (
      <span className="small">
        Nova ordem: {(p.to as string[]).map((n, i) => `${i + 1}. ${n}`).join(', ')}
      </span>
    )
  }
  if (r.type === 'SUBSTITUIR_CLIENTE' && p.clientName) {
    return (
      <span className="small">
        Trocar {String(p.replacedClientName)} por <strong>{String(p.clientName)}</strong>
      </span>
    )
  }
  return null
}

export function RequestsPage() {
  const qc = useQueryClient()
  const [range, setRange] = useState({ from: addDays(today(), -6), to: today() })
  const [promotorId, setPromotorId] = useState('')
  const [status, setStatus] = useState<RequestStatus | ''>('')
  const [deciding, setDeciding] = useState<{ request: PermissionRequest; approve: boolean } | null>(null)
  const [note, setNote] = useState('')

  const query = useQuery({
    queryKey: ['requests', range, promotorId, status],
    queryFn: () => api<PermissionRequest[]>('/admin/requests', { query: { ...range, promotorId, status } }),
    refetchInterval: 60_000,
  })

  const decide = useMutation({
    mutationFn: () => api(`/supervisor/requests/${deciding!.request.id}/decide`, { method: 'POST', body: { approve: deciding!.approve, note: note || undefined } }),
    onSuccess: () => {
      setDeciding(null)
      setNote('')
      qc.invalidateQueries({ queryKey: ['requests'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const rows = query.data ?? []
  const pending = rows.filter((r) => r.status === 'PENDENTE')

  return (
    <div>
      <PageHead
        title="Liberações"
        description="Pedidos dos promotores (check-in fora da cerca, sem fotos, mudança de ordem, troca de cliente) e liberações diretas do supervisor. Pedidos de hoje podem ser decididos aqui ou no app."
      />
      <div className="toolbar">
        <DateRange from={range.from} to={range.to} onChange={setRange} />
        <PromotorSelect value={promotorId} onChange={setPromotorId} />
        <Field label="Situação">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | '')}>
            <option value="">Todas</option>
            {Object.entries(requestStatusLabel).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />
      {query.data && rows.length === 0 && <Empty>Nenhuma liberação no período.</Empty>}
      {rows.length > 0 && (
        <div className="panel table-wrap">
          {pending.length > 0 && (
            <div className="panel-head">
              <strong>{pending.length} aguardando decisão</strong>
            </div>
          )}
          <table className="data">
            <thead>
              <tr>
                <th>Pedido em</th>
                <th>Promotor</th>
                <th>Liberação</th>
                <th>Cliente</th>
                <th>Motivo</th>
                <th>Situação</th>
                <th>Decisão</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{fmtDateTime(r.createdAt)}</td>
                  <td>{r.promotor.name}</td>
                  <td>
                    {r.typeLabel}
                    <div>
                      <PayloadText r={r} />
                    </div>
                    {r.createdBy.role !== 'PROMOTOR' && <span className="chip">Liberado direto por {r.createdBy.name}</span>}
                  </td>
                  <td>{r.visit ? `${r.visit.position}º · ${r.visit.client.name}` : '—'}</td>
                  <td style={{ maxWidth: 280 }}>{r.reason ?? '—'}</td>
                  <td>
                    <StatusPill status={r.status === 'PENDENTE' ? 'PENDENTE-req' : r.status} label={requestStatusLabel[r.status]} />
                  </td>
                  <td className="small">
                    {r.decidedBy ? (
                      <>
                        {r.decidedBy.name}, {fmtDateTime(r.decidedAt)}
                        {r.decisionNote && <div className="muted">{r.decisionNote}</div>}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {r.status === 'PENDENTE' && r.date === today() && (
                      <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn small good" onClick={() => setDeciding({ request: r, approve: true })}>
                          Aprovar
                        </button>
                        <button className="btn small danger" onClick={() => setDeciding({ request: r, approve: false })}>
                          Negar
                        </button>
                      </div>
                    )}
                    {r.status === 'PENDENTE' && r.date !== today() && <span className="muted small">Expirou em {fmtDate(r.date)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deciding && (
        <Modal
          title={deciding.approve ? 'Aprovar liberação' : 'Negar liberação'}
          onClose={() => setDeciding(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeciding(null)}>
                Voltar
              </button>
              <button className={`btn ${deciding.approve ? 'primary' : 'danger'}`} onClick={() => decide.mutate()} disabled={decide.isPending}>
                {deciding.approve ? 'Aprovar' : 'Negar'}
              </button>
            </>
          }
        >
          <div className="stack">
            <p style={{ margin: 0 }}>
              <strong>{deciding.request.typeLabel}</strong> para {deciding.request.promotor.name}
              {deciding.request.visit ? ` em ${deciding.request.visit.client.name}` : ''}.
            </p>
            {deciding.request.reason && <p className="muted" style={{ margin: 0 }}>Motivo do promotor: "{deciding.request.reason}"</p>}
            <Field label="Observação para o promotor (opcional)">
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <ErrorBox error={decide.error} />
          </div>
        </Modal>
      )}
    </div>
  )
}
