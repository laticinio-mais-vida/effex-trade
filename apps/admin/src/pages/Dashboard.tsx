import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { fmtLongDate, fmtMinutes, fmtTime, isStale, SIGNAL_STALE_MIN, timeAgo } from '../format'
import type { AlertItem, Dashboard, MapData } from '../types'
import { ErrorBox, ExecBar, Loading, PageHead } from '../ui'

type MapPromotor = MapData['promotores'][number]

const lunchOverdue = (p: MapPromotor) => !!p.lunch && !p.lunch.end && p.lunch.overdue

export function DashboardPage() {
  const navigate = useNavigate()
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/admin/dashboard'), refetchInterval: 60_000 })
  const map = useQuery({ queryKey: ['map', '', ''], queryFn: () => api<MapData>('/admin/map'), refetchInterval: 180_000 })

  if (dash.isLoading) return <Loading />
  if (dash.error || !dash.data) return <ErrorBox error={dash.error} />
  const d = dash.data
  const finished = d.visits.done + d.visits.justified
  const pct = (n: number) => `${d.visits.total ? (n / d.visits.total) * 100 : 0}%`

  // Exceções primeiro (sem sinal, almoço acima do limite), depois a ordem de sempre
  const now = map.dataUpdatedAt
  const exception = (p: MapPromotor) => isStale(p.lastPing?.recordedAt, now) || lunchOverdue(p)
  const promotores = [...(map.data?.promotores ?? [])].sort((a, b) => Number(exception(b)) - Number(exception(a)))

  const todos = [
    { to: '/liberacoes', count: d.pendingRequests, text: 'pedidos de liberação aguardando decisão' },
    { to: '/fotos', count: d.photosUnreviewed, text: 'fotos dos últimos 7 dias para você aprovar ou reprovar' },
    { to: '/contestacoes', count: d.pendingContests, text: 'contestações de fotos reprovadas esperando decisão' },
    { to: '/relatorios', count: d.visits.pending, text: 'clientes do roteiro de hoje ainda sem atendimento' },
  ].filter((t) => t.count > 0)

  return (
    <div className="stack">
      <PageHead
        title={`Hoje, ${fmtLongDate(d.date)}`}
        description={`${d.promotores} promotores em rota, ${d.online} com localização recebida nos últimos ${SIGNAL_STALE_MIN} minutos.`}
        actions={
          <Link className="btn" to="/mapa">
            Abrir mapa
          </Link>
        }
      />

      {d.alerts.length > 0 && <Alerts alerts={d.alerts} now={dash.dataUpdatedAt} />}

      <section className="kpis" aria-label="Execução do dia">
        <div className="kpi">
          <span className="kpi-label">Clientes feitos</span>
          <span className="kpi-valor tom-feito">
            {d.visits.done}
            <small>/ {d.visits.total}</small>
          </span>
          <div className="execbar" role="img" aria-label={`${d.visits.done} feitos e ${d.visits.inProgress} em atendimento de ${d.visits.total}`}>
            <span className="b-done" style={{ width: pct(d.visits.done) }} />
            <span className="b-prog" style={{ width: pct(d.visits.inProgress) }} />
          </div>
          <span className="kpi-pe">{d.visits.total ? Math.round((d.visits.done / d.visits.total) * 100) : 0}% do roteiro do dia</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Em atendimento agora</span>
          <span className="kpi-valor tom-em-atendimento">{d.visits.inProgress}</span>
          <span className="kpi-pe">{d.visits.pending} clientes ainda não atendidos</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Justificados</span>
          <span className="kpi-valor tom-justificado">{d.visits.justified}</span>
          <span className="kpi-pe">
            {finished} de {d.visits.total} com desfecho
          </span>
        </div>
        <div className="kpi acao">
          <span className="kpi-label">Liberações aguardando</span>
          <span className="kpi-valor tom-marinho">{d.pendingRequests}</span>
          {d.pendingRequests ? (
            <Link className="btn primary small" to="/liberacoes">
              Decidir
            </Link>
          ) : (
            <span className="kpi-pe">Nenhum pedido pendente</span>
          )}
        </div>
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
                  {promotores.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => navigate(`/mapa?promotor=${p.id}`)}>
                      <td>
                        <Link to={`/mapa?promotor=${p.id}`}>{p.name}</Link>
                      </td>
                      <td className="col-barra">
                        <ExecBar stats={p.stats} />
                      </td>
                      <td className="r">
                        {p.stats.done}/{p.stats.total}
                      </td>
                      <td>
                        {p.lunch && !p.lunch.end ? (
                          <span className={p.lunch.overdue ? 'texto-erro' : undefined}>
                            Almoço desde {fmtTime(p.lunch.start)}
                            {p.lunch.overdue ? ' (acima do limite)' : ''}
                          </span>
                        ) : p.currentVisit ? (
                          `${p.currentVisit.clientName} desde ${fmtTime(p.currentVisit.since)}`
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className={`nowrap ${isStale(p.lastPing?.recordedAt, now) ? 'texto-erro' : ''}`}>{timeAgo(p.lastPing?.recordedAt)}</td>
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
          <div className="panel-body todo-list">
            {todos.length ? (
              todos.map((t) => (
                <Link key={t.to} className="todo" to={t.to}>
                  <span className="todo-num">{t.count}</span>
                  <span className="todo-text">{t.text}</span>
                </Link>
              ))
            ) : (
              <p className="muted m-0">Nada pendente agora.</p>
            )}
            <p className="muted small m-0">{d.photosToday} fotos registradas hoje.</p>
          </div>
        </section>
      </div>
    </div>
  )
}

/** Alertas para o supervisor (ex.: almoço acima do limite). Somem ao marcar "ciente". */
function Alerts({ alerts, now }: { alerts: AlertItem[]; now: number }) {
  const qc = useQueryClient()
  const ack = useMutation({
    mutationFn: (id: string) => api(`/supervisor/alerts/${id}/ack`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })
  return (
    <section className="panel alerta" aria-label="Alertas">
      <div className="panel-head">
        <h2>{alerts.length === 1 ? '1 alerta' : `${alerts.length} alertas`} para o supervisor</h2>
      </div>
      <table className="data">
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td>
                <strong>{a.message}</strong>
                <div className="small muted">
                  {a.resolvedAt
                    ? `Voltou às ${fmtTime(a.lunchEndedAt ?? a.resolvedAt)}${a.lunchStartedAt && a.lunchEndedAt ? `, ${fmtMinutes((new Date(a.lunchEndedAt).getTime() - new Date(a.lunchStartedAt).getTime()) / 60_000)} de almoço` : ''}.`
                    : a.lunchStartedAt
                      ? `Em almoço há ${fmtMinutes((now - new Date(a.lunchStartedAt).getTime()) / 60_000)}${a.promotor.phone ? `. Telefone ${a.promotor.phone}` : ''}.`
                      : ''}
                </div>
              </td>
              <td className="col-acao">
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
