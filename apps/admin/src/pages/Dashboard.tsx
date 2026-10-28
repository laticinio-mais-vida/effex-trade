import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { fmtLongDate, fmtMinutes, fmtTime, timeAgo } from '../format'
import type { AlertItem, Dashboard, MapData } from '../types'
import { ErrorBox, ExecBar, Loading, PageHead } from '../ui'

export function DashboardPage() {
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/admin/dashboard'), refetchInterval: 60_000 })
  const map = useQuery({ queryKey: ['map', '', ''], queryFn: () => api<MapData>('/admin/map'), refetchInterval: 180_000 })

  if (dash.isLoading) return <Loading />
  if (dash.error || !dash.data) return <ErrorBox error={dash.error} />
  const d = dash.data
  const finished = d.visits.done + d.visits.justified

  return (
    <div className="stack">
      <PageHead
        title={`Hoje, ${fmtLongDate(d.date)}`}
        description={`${d.promotores} promotores em rota, ${d.online} com localização recebida nos últimos 15 minutos.`}
        actions={
          <Link className="btn" to="/mapa">
            Abrir mapa
          </Link>
        }
      />

      {d.alerts.length > 0 && <Alerts alerts={d.alerts} />}

      <section className="tags" aria-label="Execução do dia">
        <div className="shelf-tag">
          <span className="tag-label">Clientes feitos</span>
          <span className="tag-value num">
            {d.visits.done}
            <small>/ {d.visits.total}</small>
          </span>
          <span className="tag-foot">{d.visits.total ? Math.round((d.visits.done / d.visits.total) * 100) : 0}% do roteiro do dia</span>
        </div>
        <div className="shelf-tag">
          <span className="tag-label">Em atendimento agora</span>
          <span className="tag-value num">{d.visits.inProgress}</span>
          <span className="tag-foot">{d.visits.pending} clientes ainda não atendidos</span>
        </div>
        <div className="shelf-tag alt">
          <span className="tag-label">Justificados</span>
          <span className="tag-value num">{d.visits.justified}</span>
          <span className="tag-foot">{finished} de {d.visits.total} com desfecho</span>
        </div>
        <Link to="/liberacoes" className="shelf-tag alt" style={{ textDecoration: 'none' }}>
          <span className="tag-label">Liberações aguardando</span>
          <span className="tag-value num">{d.pendingRequests}</span>
          <span className="tag-foot">{d.pendingRequests ? 'Toque para decidir' : 'Nenhum pedido pendente'}</span>
        </Link>
      </section>

      <div className="cols-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Promotores</h2>
            <span className="muted small">atualiza a cada 3 min</span>
          </div>
          {map.isLoading ? (
            <Loading />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Promotor</th>
                    <th>Execução</th>
                    <th className="r">Feitos</th>
                    <th>Agora</th>
                    <th>Último sinal</th>
                  </tr>
                </thead>
                <tbody>
                  {map.data?.promotores.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/mapa?promotor=${p.id}`}>{p.name}</Link>
                      </td>
                      <td style={{ minWidth: 140, verticalAlign: 'middle' }}>
                        <ExecBar stats={p.stats} />
                      </td>
                      <td className="r">
                        {p.stats.done}/{p.stats.total}
                      </td>
                      <td>
                        {p.lunch && !p.lunch.end ? (
                          <span style={{ color: p.lunch.overdue ? 'var(--notdone)' : undefined, fontWeight: p.lunch.overdue ? 600 : undefined }}>
                            Almoço desde {fmtTime(p.lunch.start)}
                          </span>
                        ) : p.currentVisit ? (
                          `${p.currentVisit.clientName} desde ${fmtTime(p.currentVisit.since)}`
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className={p.lastPing ? '' : 'muted'}>{timeAgo(p.lastPing?.recordedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Para fazer</h2>
          </div>
          <div className="panel-body stack">
            <TodoLine to="/liberacoes" count={d.pendingRequests} text="pedidos de liberação aguardando decisão" />
            <TodoLine to="/fotos" count={d.photosUnreviewed} text="fotos dos últimos 7 dias sem nota" />
            <TodoLine to="/relatorios" count={d.visits.pending} text="clientes do roteiro de hoje ainda sem atendimento" />
            <p className="muted small" style={{ margin: 0 }}>
              {d.photosToday} fotos registradas hoje.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

/** Alertas para o supervisor (ex.: almoço acima do limite). Somem ao marcar "ciente". */
function Alerts({ alerts }: { alerts: AlertItem[] }) {
  const qc = useQueryClient()
  const ack = useMutation({
    mutationFn: (id: string) => api(`/supervisor/alerts/${id}/ack`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })
  return (
    <section className="panel" style={{ borderColor: '#f0c8c4' }} aria-label="Alertas">
      <div className="panel-head" style={{ background: 'var(--notdone-bg)' }}>
        <h2 style={{ color: '#8f2a24' }}>
          {alerts.length === 1 ? '1 alerta' : `${alerts.length} alertas`} para o supervisor
        </h2>
      </div>
      <table className="data">
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td style={{ verticalAlign: 'middle' }}>
                <strong>{a.message}</strong>
                <div className="small muted">
                  {a.resolvedAt
                    ? `Voltou às ${fmtTime(a.lunchEndedAt ?? a.resolvedAt)}${a.lunchStartedAt && a.lunchEndedAt ? `, ${fmtMinutes((new Date(a.lunchEndedAt).getTime() - new Date(a.lunchStartedAt).getTime()) / 60_000)} de almoço` : ''}.`
                    : a.lunchStartedAt
                      ? `Em almoço há ${fmtMinutes((Date.now() - new Date(a.lunchStartedAt).getTime()) / 60_000)}${a.promotor.phone ? `. Telefone ${a.promotor.phone}` : ''}.`
                      : ''}
                </div>
              </td>
              <td style={{ width: 120, verticalAlign: 'middle' }}>
                <button className="btn small" onClick={() => ack.mutate(a.id)} disabled={ack.isPending}>
                  Ciente
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function TodoLine({ to, count, text }: { to: string; count: number; text: string }) {
  return (
    <Link to={to} style={{ display: 'flex', gap: 12, alignItems: 'baseline', textDecoration: 'none', color: 'inherit' }}>
      <span className="cond num" style={{ fontSize: 30, fontWeight: 700, color: count ? 'var(--ink)' : 'var(--faint)', minWidth: 44 }}>
        {count}
      </span>
      <span>{text}</span>
    </Link>
  )
}
