import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { api, downloadFile } from '../api'
import { fmtDate, fmtDiff, fmtHms, fmtLongDate, fmtShort, fmtTime, today } from '../format'
import { Icon } from '../icons'
import type { TimeNotVisited, TimeOccurrence, TimePromotorDay, TimeReport } from '../types'
import { Empty, ErrorBox, Field, Loading, PageHead } from '../ui'

const kindLabel = (o: TimeOccurrence) => (o.kind === 'DESLOCAMENTO' ? 'Deslocamento longo' : o.direction === 'ACIMA' ? 'Tempo longo na loja' : 'Tempo curto na loja')
const ratioText = (r: number) => `${r >= 100 ? '99+' : r.toFixed(1)}x`
const when = (o: TimeOccurrence) => `${fmtTime(o.from)} – ${fmtTime(o.to)}`
const stateLabel = { JUSTIFICADA: 'Justificado', NAO_FEITA: 'Sem justificativa', PENDENTE: 'A visitar', EM_ATENDIMENTO: 'Em atendimento', FEITA: 'Feito' } as const

type Item = { day: TimePromotorDay; o: TimeOccurrence }

export function TimesPage() {
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [promotor, setPromotor] = useState('')
  const isToday = to === today()
  const ranged = from !== to

  const query = useQuery({
    queryKey: ['time-report', from, to],
    queryFn: () => api<TimeReport>('/admin/time-report', { query: { from, to } }),
    // No dia de hoje o relatório acompanha o campo: confere de novo a cada minuto
    refetchInterval: isToday ? 60_000 : false,
  })
  const data = query.data

  const pdf = useMutation({
    mutationFn: ({ key, format }: { key: string; format: 'pdf' | 'jpeg' }) =>
      downloadFile('/admin/time-report/pdf', { from, to, promotor: key || undefined, format }, `roteiros-${from}${ranged ? `-a-${to}` : ''}.${format === 'jpeg' ? 'jpg' : 'pdf'}`),
  })

  const days = data ? (promotor ? data.promotores.filter((p) => p.key === promotor) : data.promotores) : []
  const items: Item[] = days.flatMap((day) => day.occurrences.map((o) => ({ day, o })))
  const byBiggest = (a: Item, b: Item) => a.day.name.localeCompare(b.day.name, 'pt-BR') || a.o.date.localeCompare(b.o.date) || Math.abs(b.o.diffSeconds) - Math.abs(a.o.diffSeconds)
  const rotAbove = items.filter(({ o }) => o.kind === 'ROTEIRO' && o.direction === 'ACIMA').sort(byBiggest)
  const rotBelow = items.filter(({ o }) => o.kind === 'ROTEIRO' && o.direction === 'ABAIXO').sort(byBiggest)
  const travel = items.filter(({ o }) => o.kind === 'DESLOCAMENTO').sort(byBiggest)
  const notVisited = days
    .flatMap((day) => day.notVisitedList.map((n) => ({ day, n })))
    .sort((a, b) => a.day.name.localeCompare(b.day.name, 'pt-BR') || a.n.date.localeCompare(b.n.date) || a.n.clientName.localeCompare(b.n.clientName, 'pt-BR'))

  const totals = {
    visited: days.reduce((s, p) => s + p.visited, 0),
    total: days.reduce((s, p) => s + p.total, 0),
    notVisited: days.reduce((s, p) => s + p.notVisited, 0),
    pending: days.reduce((s, p) => s + p.pending + p.inProgress, 0),
  }
  const anyFallback = items.some(({ o }) => o.fallback)

  return (
    <div className="stack">
      <PageHead
        title="Tempos de roteiro"
        description={`${ranged ? `${fmtDate(from)} a ${fmtDate(to)}` : fmtLongDate(from)} · ${isToday ? `acumulado até o último registro${ranged ? '' : ' do dia'}` : ranged ? 'período encerrado' : 'dia encerrado'}`}
        help={
          <>
            <p>
              Compara o <strong>tempo em cada cliente</strong> e o <strong>deslocamento</strong> de cada promotor com a <strong>média do histórico</strong> (últimos 3 meses antes do dia). Um tempo é sinalizado quando passa de
              <strong> 2 vezes</strong> a média e fica pelo menos <strong>15 minutos</strong> acima dela; o tempo em loja também é sinalizado quando fica abaixo de 0,5 vez a média e pelo menos 15 minutos abaixo. Deslocamento curto não é sinalizado.
            </p>
            <p>
              A média do tempo em loja é a do cliente (todos os promotores); a do deslocamento é do promotor naquele cliente. Ela é calculada pelo valor do meio do histórico (e não pela soma), para que um check-out esquecido por horas não distorça o resultado.
              Com menos de 3 visitas no histórico, vale a média geral e a linha leva <strong>*</strong>. O deslocamento é do check-out do cliente anterior até o check-in, sem o almoço.
            </p>
            <p>
              É o mesmo relatório que o supervisor recebe: de manhã, o dia anterior fechado; à tarde, o de hoje, que mostra tudo o que já aconteceu até o último registro (a página se atualiza a cada minuto). Para ver vários dias, escolha a data inicial e a final (até 31 dias): cada ocorrência aparece com o seu dia. Dias anteriores ao EFFEX vêm do histórico importado do TradePro.
            </p>
          </>
        }
      />

      <div className="toolbar">
        <Field label="De">
          <input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </Field>
        <Field label="Até">
          <input
            className="input"
            type="date"
            value={to}
            min={from}
            max={today()}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </Field>
        <Field label="Promotor">
          <select className="input" value={promotor} onChange={(e) => setPromotor(e.target.value)}>
            <option value="">Todos os promotores</option>
            {data?.promotores.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Consolidado de todos">
          <div className="btn-row">
            <button className="btn" onClick={() => pdf.mutate({ key: '', format: 'pdf' })} disabled={!data?.promotores.length || pdf.isPending}>
              PDF
            </button>
            <button className="btn" onClick={() => pdf.mutate({ key: '', format: 'jpeg' })} disabled={!data?.promotores.length || pdf.isPending}>
              JPEG
            </button>
          </div>
        </Field>
        <Field label={promotor ? `Individual: ${days[0]?.name ?? ''}` : 'Individual (escolha um promotor)'}>
          <div className="btn-row">
            <button className="btn" onClick={() => pdf.mutate({ key: promotor, format: 'pdf' })} disabled={!promotor || pdf.isPending} title="Só a página deste promotor, para enviar a ele">
              PDF
            </button>
            <button className="btn" onClick={() => pdf.mutate({ key: promotor, format: 'jpeg' })} disabled={!promotor || pdf.isPending} title="Só a página deste promotor, para enviar a ele">
              JPEG
            </button>
          </div>
        </Field>
      </div>
      <ErrorBox error={pdf.error} />

      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />
      {data?.warnings.map((w) => (
        <p key={w} className="chip warn">
          {w}
        </p>
      ))}
      {data && !data.promotores.length && !data.warnings.length && <Empty>Nenhum roteiro nesta data.</Empty>}

      {data && days.length > 0 && (
        <>
          <section className="kpis" aria-label="Resumo do dia">
            <div className="kpi">
              <span className="kpi-label">Visitas feitas</span>
              <span className="kpi-valor tom-feito">
                {totals.visited}
                <small>/ {totals.total}</small>
              </span>
              <span className="kpi-pe">{days.length} promotor(es){totals.pending ? ` · ${totals.pending} a visitar ou em atendimento` : ''}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Fora da média</span>
              <span className={`kpi-valor ${items.length ? 'tom-justificado' : ''}`}>{items.length}</span>
              <span className="kpi-pe">{travel.length} deslocamento(s) · {rotAbove.length + rotBelow.length} tempo(s) em loja</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Clientes não visitados</span>
              <span className={`kpi-valor ${totals.notVisited ? 'tom-nao-feito' : ''}`}>{totals.notVisited}</span>
              <span className="kpi-pe">justificados ou sem visita</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Origem dos dados</span>
              <span className="kpi-valor">{data.source === 'EFFEX' ? 'EFFEX' : data.source === 'MISTO' ? 'EFFEX + TradePro' : 'TradePro'}</span>
              <span className="kpi-pe">
                {data.baseline ? `Referência: ${fmtDate(data.baseline.from)} a ${fmtDate(data.baseline.to)} (${data.baseline.observations} visitas)` : 'Sem referência'}
                {isToday ? ` · atualizado às ${fmtTime(data.generatedAt)}` : ''}
              </span>
            </div>
          </section>

          <Section title="Resumo por promotor" count={days.length}>
            <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Promotor</th>
                  <th>Visitas</th>
                  <th>Sem visita</th>
                  <th>Tempo em loja</th>
                  <th>Deslocamento</th>
                  {!ranged && <th>Primeira</th>}
                  {!ranged && <th>Última</th>}
                  <th>Fora da média</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {days.map((p) => (
                  <tr key={p.key}>
                    <td>
                      <button className="linklike" onClick={() => setPromotor(promotor === p.key ? '' : p.key)} title="Filtrar por este promotor">
                        <strong>{p.name}</strong>
                      </button>
                      {p.supervisor && <div className="small muted">{p.supervisor}</div>}
                      {p.outsideDay > 0 && (
                        <div className="small" style={{ color: 'var(--nao-feito)' }}>
                          {p.outsideDay} visita(s) registrada(s) em outro dia (roteiro aberto)
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {p.visited} de {p.total}
                      {p.pending + p.inProgress > 0 && <div className="small muted">{p.pending + p.inProgress} a visitar</div>}
                    </td>
                    <td className="num">{p.notVisited}</td>
                    <td className="num">{fmtShort(p.clientSeconds)}</td>
                    <td className="num">{fmtShort(p.travelSeconds)}</td>
                    {!ranged && <td className="num">{fmtTime(p.firstCheckin)}</td>}
                    {!ranged && <td className="num">{fmtTime(p.lastCheckout)}</td>}
                    <td className="num">{p.occurrences.length ? <span className="pill st-JUSTIFICADA">{p.occurrences.length}</span> : '—'}</td>
                    <td>
                      <div className="btn-row">
                        <button className="btn small" onClick={() => pdf.mutate({ key: p.key, format: 'pdf' })} disabled={pdf.isPending}>
                          PDF
                        </button>
                        <button className="btn small" onClick={() => pdf.mutate({ key: p.key, format: 'jpeg' })} disabled={pdf.isPending}>
                          JPEG
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Section>

          <OccSection title="Tempo no roteiro acima da média" items={rotAbove} ranged={ranged} baseLabel="Média do cliente" tone="alto" />
          <OccSection title="Tempo no roteiro abaixo da média" items={rotBelow} ranged={ranged} baseLabel="Média do cliente" tone="baixo" />
          <OccSection title="Tempo de deslocamento acima da média" items={travel} ranged={ranged} baseLabel="Média do trajeto" tone="alto" />
          <NotVisitedSection list={notVisited} ranged={ranged} />
          {anyFallback && <p className="small muted">* sem histórico suficiente para a referência própria: comparação feita contra a média geral.</p>}
        </>
      )}
    </div>
  )
}

function OccSection({ title, items, baseLabel, tone, ranged }: { title: string; items: Item[]; baseLabel: string; tone: 'alto' | 'baixo'; ranged: boolean }) {
  const qc = useQueryClient()
  const ack = useMutation({
    mutationFn: (id: string) => api(`/admin/time-flags/${id}/ack`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time-report'] }),
  })
  const color = tone === 'alto' ? 'var(--justificado)' : 'var(--em-atendimento)'
  return (
    <Section title={title} count={items.length}>
      {items.length === 0 ? (
        <p className="small muted">Nenhuma ocorrência.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {ranged && <th>Data</th>}
                <th>Promotor</th>
                <th>Cliente</th>
                <th>Cidade</th>
                <th>Horário</th>
                <th>Tempo do dia</th>
                <th>{baseLabel}</th>
                <th>Diferença</th>
                <th>Variação</th>
                <th>Justificativa do promotor</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ day, o }) => (
                <tr key={`${o.rowId}-${o.kind}`} title={kindLabel(o)}>
                  {ranged && <td className="num">{fmtDate(o.date).slice(0, 5)}</td>}
                  <td>
                    <strong>{day.name}</strong>
                  </td>
                  <td>{o.clientName}</td>
                  <td>{o.city ?? '—'}</td>
                  <td className="num">{when(o)}</td>
                  <td className="num">{fmtHms(o.valueSeconds)}</td>
                  <td className="num">
                    {fmtHms(o.baseSeconds)}
                    {o.fallback ? ' *' : ''}
                  </td>
                  <td className="num" style={{ color, fontWeight: 600 }}>
                    {fmtDiff(o.diffSeconds)}
                  </td>
                  <td className="num" style={{ color, fontWeight: 600 }}>
                    {ratioText(o.ratio)}
                  </td>
                  <td>
                    {o.flag?.justification ? <span>{o.flag.justification}</span> : <span className="muted">{o.flag ? 'Sem justificativa' : '—'}</span>}
                    {o.flag && !o.flag.acknowledgedAt && (
                      <div>
                        <button className="btn small" onClick={() => ack.mutate(o.flag!.id)} disabled={ack.isPending}>
                          Ciente
                        </button>
                      </div>
                    )}
                    {o.flag?.acknowledgedAt && <div className="small muted">Ciente</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function NotVisitedSection({ list, ranged }: { list: { day: TimePromotorDay; n: TimeNotVisited }[]; ranged: boolean }) {
  return (
    <Section title="Clientes não visitados" count={list.length}>
      {list.length === 0 ? (
        <p className="small muted">Todos os clientes do roteiro foram visitados.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {ranged && <th>Data</th>}
                <th>Promotor</th>
                <th>Cliente</th>
                <th>Cidade</th>
                <th>Motivo</th>
                <th>Justificativa</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ day, n }) => (
                <tr key={n.rowId}>
                  {ranged && <td className="num">{fmtDate(n.date).slice(0, 5)}</td>}
                  <td>
                    <strong>{day.name}</strong>
                  </td>
                  <td>{n.clientName}</td>
                  <td>{n.city ?? '—'}</td>
                  <td>{n.reason ?? '—'}</td>
                  <td>{n.comment ?? '—'}</td>
                  <td>
                    <span className={`pill st-${n.state === 'JUSTIFICADA' ? 'JUSTIFICADA' : 'PENDENTE'}`}>{stateLabel[n.state]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

/** Seção do relatório que recolhe e expande pela seta no título. */
function Section({ title, count, children, defaultOpen = true }: { title: string; count?: number; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="panel">
      <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={open ? 'chevron-down' : 'chevron-forward'} />
        <h2>
          {title}
          {count != null && <span className="muted"> · {count}</span>}
        </h2>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  )
}
