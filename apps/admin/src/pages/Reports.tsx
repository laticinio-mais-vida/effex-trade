import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '../api'
import { addDays, downloadCsv, fmtDate, fmtMinutes, fmtNumber, fmtTime, fmtTimeOn, originLabel, today, visitStatusLabel } from '../format'
import type { Report, ReportRow, VisitStatus } from '../types'
import { DateRange, Empty, ErrorBox, Loading, PageHead, PromotorSelect, Segmented, StatusPill, Tabs } from '../ui'

type Tab = 'resumo' | 'jornadas' | 'visitas' | 'rupturas' | 'justificativas'
type StatusFilter = 'todos' | VisitStatus

const permissionShort: Record<string, string> = {
  CHECKIN_FORA_CERCA: 'Cerca',
  DISPENSA_FOTOS: 'Sem fotos',
  ALTERAR_ORDEM: 'Ordem',
  SUBSTITUIR_CLIENTE: 'Substituição',
}

export function ReportsPage() {
  const [range, setRange] = useState({ from: addDays(today(), -6), to: today() })
  const [promotorId, setPromotorId] = useState('')
  const [tab, setTab] = useState<Tab>('resumo')
  const [status, setStatus] = useState<StatusFilter>('todos')

  const query = useQuery({
    queryKey: ['report', range, promotorId],
    queryFn: () => api<Report>('/admin/reports/visits', { query: { ...range, promotorId } }),
  })
  const data = query.data

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => status === 'todos' || r.status === status), [data, status])

  const exportCsv = () => {
    if (!data) return
    downloadCsv(
      `execucao-${range.from}-a-${range.to}.csv`,
      ['Data', 'Promotor', 'Ordem', 'Origem', 'Código', 'Cliente', 'Cidade', 'Status', 'Check-in', 'Check-out', 'Encerrado automaticamente', 'Aberturas', 'Tempo no cliente (min)', 'Deslocamento (min)', 'Deslocamento (km)', 'Distância no check-in (m)', 'Fotos', 'Rupturas', 'Motivo', 'Justificativa', 'Liberações'],
      data.rows.map((r) => [
        fmtDate(r.date),
        r.promotor.name,
        r.position,
        originLabel[r.origin],
        r.client.code,
        r.client.name,
        r.client.city,
        visitStatusLabel[r.status],
        r.checkinAt ? fmtTime(r.checkinAt) : '',
        r.checkoutAt ? fmtTime(r.checkoutAt) : '',
        r.autoClosed ? 'sim' : '',
        r.sessions.map((s) => `${fmtTime(s.checkinAt)}-${s.checkoutAt ? fmtTime(s.checkoutAt) : 'aberto'}`).join(' / '),
        r.durationMin,
        r.travelMin,
        r.travelKm,
        r.checkinDistance,
        r.photoCount,
        r.ruptures.map((p) => p.name).join(', '),
        r.justification?.reason,
        r.justification?.text,
        r.approvedRequests.map((t) => permissionShort[t] ?? t).join(', '),
      ]),
    )
  }

  return (
    <div>
      <PageHead
        title="Relatório de execução"
        description="Tempo em cada cliente, deslocamento entre um atendimento e o próximo e justificativas de não atendimento."
        actions={
          <button className="btn" onClick={exportCsv} disabled={!data?.rows.length}>
            Exportar planilha
          </button>
        }
      />
      <div className="toolbar">
        <DateRange from={range.from} to={range.to} onChange={setRange} />
        <PromotorSelect value={promotorId} onChange={setPromotorId} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'resumo', label: 'Resumo por promotor' },
          { value: 'jornadas', label: 'Jornadas' },
          { value: 'visitas', label: 'Visitas' },
          { value: 'rupturas', label: 'Rupturas' },
          { value: 'justificativas', label: 'Justificativas' },
        ]}
      />
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />
      {data && data.rows.length === 0 && <Empty>Nenhuma visita no período. Ajuste as datas ou o promotor.</Empty>}
      {data && data.rows.length > 0 && (
        <>
          {tab === 'resumo' && <Summary data={data} />}
          {tab === 'jornadas' && <Days data={data} />}
          {tab === 'visitas' && (
            <>
              <div className="toolbar">
                <Segmented<StatusFilter>
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: 'todos', label: `Todas (${data.rows.length})` },
                    { value: 'CONCLUIDA', label: 'Feitas' },
                    { value: 'JUSTIFICADA', label: 'Justificadas' },
                    { value: 'PENDENTE', label: 'Não feitas' },
                    { value: 'EM_ATENDIMENTO', label: 'Em atendimento' },
                  ]}
                />
              </div>
              <Visits rows={rows} />
            </>
          )}
          {tab === 'rupturas' && <Ruptures data={data} />}
          {tab === 'justificativas' && <Justifications data={data} />}
        </>
      )}
    </div>
  )
}

function Summary({ data }: { data: Report }) {
  return (
    <div className="panel table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Promotor</th>
            <th className="r">Dias</th>
            <th className="r">Visitas</th>
            <th className="r">Feitas</th>
            <th className="r">Justificadas</th>
            <th className="r">Não feitas</th>
            <th className="r">Extras</th>
            <th className="r">Execução</th>
            <th className="r">Média no cliente</th>
            <th className="r">Total em clientes</th>
            <th className="r">Média de deslocamento</th>
            <th className="r">Total de deslocamento</th>
            <th className="r">Rupturas</th>
            <th className="r">Encerr. automático</th>
            <th className="r">Liberações</th>
          </tr>
        </thead>
        <tbody>
          {data.summary.map((s) => (
            <tr key={s.promotor.id}>
              <td className="nowrap">
                <strong>{s.promotor.name}</strong>
              </td>
              <td className="r">{s.days}</td>
              <td className="r">{s.total}</td>
              <td className="r">{s.done}</td>
              <td className="r">{s.justified}</td>
              <td className="r" style={{ color: s.notDone ? 'var(--notdone)' : undefined }}>
                {s.notDone}
              </td>
              <td className="r">{s.extras}</td>
              <td className="r">
                <strong>{fmtNumber(s.executionRate, 1)}%</strong>
              </td>
              <td className="r">{fmtMinutes(s.avgClientMin)}</td>
              <td className="r">{fmtMinutes(s.totalClientMin)}</td>
              <td className="r">{fmtMinutes(s.avgTravelMin)}</td>
              <td className="r">{fmtMinutes(s.totalTravelMin)}</td>
              <td className="r">{s.ruptures}</td>
              <td className="r" style={{ color: s.autoClosed ? 'var(--justified)' : undefined }}>
                {s.autoClosed}
              </td>
              <td className="r" title="Check-ins fora da cerca liberados / visitas liberadas sem fotos">
                {s.geofenceWaivers + s.photoWaivers}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Days({ data }: { data: Report }) {
  return (
    <div className="panel table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Data</th>
            <th>Promotor</th>
            <th title="Abertura do primeiro atendimento">Início do trabalho</th>
            <th>Almoço</th>
            <th title="Horário da última atividade">Fim do trabalho</th>
            <th className="r" title="Fim - início - almoço">Horas trabalhadas</th>
            <th title="Quando o roteiro foi encerrado">Roteiro encerrado</th>
            <th className="r">Visitas</th>
            <th className="r">Feitas</th>
            <th className="r">Justif.</th>
            <th className="r">Não feitas</th>
            <th className="r">Em clientes</th>
            <th className="r">Deslocamento</th>
          </tr>
        </thead>
        <tbody>
          {data.days.map((d) => (
            <tr key={`${d.date}-${d.promotor.id}`}>
              <td className="num">{fmtDate(d.date)}</td>
              <td className="nowrap">{d.promotor.name}</td>
              <td className="num">{fmtTime(d.workStart)}</td>
              <td className="num nowrap">
                {d.lunchStart ? (
                  <>
                    {fmtTime(d.lunchStart)}–{d.lunchEnd ? fmtTime(d.lunchEnd) : 'em curso'}
                    {d.lunchMin != null && <div className="small muted">{fmtMinutes(d.lunchMin)}</div>}
                    {d.lunchOverdue && (
                      <div>
                        <span className="chip warn" title="O almoço passou do limite das regras e o supervisor foi alertado">
                          acima do limite
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="num">{fmtTime(d.workEnd)}</td>
              <td className="r">{fmtMinutes(d.workedMin)}</td>
              <td className="num" title={d.closedAt && fmtTimeOn(d.closedAt, d.date) !== fmtTime(d.closedAt) ? 'Encerrado pelo sistema na abertura do roteiro seguinte' : undefined}>
                {fmtTimeOn(d.closedAt, d.date)}
              </td>
              <td className="r">{d.total}</td>
              <td className="r">{d.done}</td>
              <td className="r">{d.justified}</td>
              <td className="r" style={{ color: d.notDone ? 'var(--notdone)' : undefined }}>
                {d.notDone}
              </td>
              <td className="r">{fmtMinutes(d.clientMin)}</td>
              <td className="r">{fmtMinutes(d.travelMin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Visits({ rows }: { rows: ReportRow[] }) {
  if (rows.length === 0) return <Empty>Nenhuma visita com este status.</Empty>
  return (
    <div className="panel table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Data</th>
            <th>Promotor</th>
            <th className="r">#</th>
            <th>Cliente</th>
            <th>Status</th>
            <th>Check-in</th>
            <th>Check-out</th>
            <th className="r">No cliente</th>
            <th className="r">Deslocamento</th>
            <th className="r">Dist. check-in</th>
            <th className="r">Fotos</th>
            <th>Rupturas</th>
            <th>Justificativa / liberações</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="num">{fmtDate(r.date)}</td>
              <td className="nowrap">{r.promotor.name}</td>
              <td className="r">{r.position}</td>
              <td>
                {r.client.code && <span className="muted">{r.client.code} </span>}
                {r.client.name}
                {r.origin !== 'ROTEIRO' && (
                  <>
                    {' '}
                    <span className="chip">{originLabel[r.origin]}</span>
                  </>
                )}
              </td>
              <td>
                <StatusPill status={r.status} />
              </td>
              <td className="num">
                {fmtTime(r.checkinAt)}
                {r.sessions.length > 1 && (
                  <div className="small muted nowrap" title="O promotor voltou ao cliente e reabriu o atendimento">
                    <span className="chip">Reaberto</span>
                    {r.sessions.map((s, i) => (
                      <div key={i}>
                        {fmtTime(s.checkinAt)}–{s.checkoutAt ? fmtTime(s.checkoutAt) : 'aberto'}
                      </div>
                    ))}
                  </div>
                )}
              </td>
              <td className="num">
                {fmtTime(r.checkoutAt)}
                {r.autoClosed && (
                  <div>
                    <span className="chip warn" title="O promotor esqueceu o check-out; a saída foi registrada na última foto tirada no atendimento">
                      Automático
                    </span>
                  </div>
                )}
              </td>
              <td className="r">{fmtMinutes(r.durationMin)}</td>
              <td className="r">
                {fmtMinutes(r.travelMin)}
                {r.travelKm != null && <div className="small muted">{fmtNumber(r.travelKm, 1)} km</div>}
                {r.afterLunch && (
                  <div>
                    <span className="chip" title="Deslocamento contado até a abertura do almoço; a volta do almoço é a abertura deste cliente">
                      até o almoço
                    </span>
                  </div>
                )}
              </td>
              <td className="r">{r.checkinDistance != null ? `${r.checkinDistance} m` : '—'}</td>
              <td className="r">{r.photoCount}</td>
              <td className="small" style={{ minWidth: 220 }}>
                {r.ruptures.length ? r.ruptures.map((p) => p.name).join(', ') : <span className="muted">—</span>}
              </td>
              <td style={{ maxWidth: 320 }}>
                {r.justification && (
                  <div>
                    <strong>{r.justification.reason}</strong>: {r.justification.text}
                  </div>
                )}
                {r.approvedRequests.length > 0 && (
                  <div className="btn-row" style={{ gap: 4, marginTop: 2 }}>
                    {r.approvedRequests.map((t, i) => (
                      <span key={i} className="chip warn">
                        {permissionShort[t] ?? t}
                      </span>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Ruptures({ data }: { data: Report }) {
  const items = data.rows.flatMap((r) => r.ruptures.map((p) => ({ row: r, product: p })))
  if (items.length === 0) return <Empty>Nenhuma ruptura confirmada no período.</Empty>
  const byProduct = new Map<string, { name: string; count: number; clients: Set<string> }>()
  for (const { row, product } of items) {
    const entry = byProduct.get(product.id) ?? { name: product.name, count: 0, clients: new Set<string>() }
    entry.count++
    entry.clients.add(row.client.id)
    byProduct.set(product.id, entry)
  }
  const ranking = [...byProduct.values()].sort((a, b) => b.count - a.count)
  const max = Math.max(1, ...ranking.map((r) => r.count))
  return (
    <div className="cols-2">
      <section className="panel table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Data</th>
              <th>Promotor</th>
              <th>Cliente</th>
              <th>Produto em ruptura</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ row, product }) => (
              <tr key={`${row.id}-${product.id}`}>
                <td className="num">{fmtDate(row.date)}</td>
                <td className="nowrap">{row.promotor.name}</td>
                <td>{row.client.name}</td>
                <td>
                  <span className="muted">{product.code} </span>
                  {product.name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Produtos com mais ruptura</h2>
        </div>
        <div className="panel-body stack">
          <p className="muted small" style={{ margin: 0 }}>
            Produtos do mix do cliente que não apareciam nas fotos de depois e o promotor confirmou como ruptura.
          </p>
          {ranking.map((r) => (
            <div key={r.name} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{r.name}</span>
                <span className="num">
                  <strong>{r.count}</strong> <span className="muted small">em {r.clients.size} {r.clients.size === 1 ? 'cliente' : 'clientes'}</span>
                </span>
              </div>
              <div className="execbar">
                <span className="b-pend" style={{ width: `${(r.count / max) * 100}%`, background: 'var(--notdone)' }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Justifications({ data }: { data: Report }) {
  const justified = data.rows.filter((r) => r.justification)
  const byReason = new Map<string, number>()
  for (const r of justified) byReason.set(r.justification!.reason ?? 'Sem motivo', (byReason.get(r.justification!.reason ?? 'Sem motivo') ?? 0) + 1)
  const sorted = [...byReason.entries()].sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...sorted.map(([, n]) => n))
  if (justified.length === 0) return <Empty>Nenhuma justificativa no período.</Empty>
  return (
    <div className="cols-2">
      <section className="panel table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Data</th>
              <th>Promotor</th>
              <th>Cliente</th>
              <th>Motivo</th>
              <th>Texto do promotor</th>
              <th>Hora</th>
            </tr>
          </thead>
          <tbody>
            {justified.map((r) => (
              <tr key={r.id}>
                <td className="num">{fmtDate(r.date)}</td>
                <td>{r.promotor.name}</td>
                <td>{r.client.name}</td>
                <td>{r.justification!.reason}</td>
                <td style={{ maxWidth: 360 }}>{r.justification!.text}</td>
                <td className="num">{fmtTime(r.justification!.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Motivos mais usados</h2>
        </div>
        <div className="panel-body stack">
          {sorted.map(([reason, n]) => (
            <div key={reason} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{reason}</span>
                <strong className="num">{n}</strong>
              </div>
              <div className="execbar">
                <span className="b-just" style={{ width: `${(n / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
