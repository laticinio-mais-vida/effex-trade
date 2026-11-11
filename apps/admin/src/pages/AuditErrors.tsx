import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, apiUrl, downloadFile } from '../api'
import { JustificationBox, PhotoFacts } from '../audit'
import { auditLabel, MIN_JUSTIFICATION, useViewerKeys, verdictLabel } from '../audit-labels'
import { useAuth } from '../auth'
import { addDays, fmtDate, fmtDateTime, fmtNumber, photoTypeLabel, today } from '../format'
import type { AuditErrors, Paged, ReviewVerdict, VendorAudit } from '../types'
import { DateRange, Empty, ErrorBox, Field, Loading, Modal, NavArrows, PageHead, Pager, Segmented, Shortcut, StatusPill, Tabs, useLookups } from '../ui'

type Tab = 'conferir' | 'correcoes'
type ReviewState = 'pendentes' | 'conferidas' | 'todas'
const PAGE_SIZE = 48

export function AuditErrorsPage() {
  const { user } = useAuth()
  const lookups = useLookups()
  // O supervisor confere só os vendedores ligados a ele (Usuários > Supervisor); o administrador, todos
  const vendedores = (lookups.data?.vendedores ?? []).filter((v) => user?.role === 'ADMIN' || v.supervisorId === user?.id)
  const [chosenId, setChosenId] = useState('')
  const vendedorId = vendedores.some((v) => v.id === chosenId) ? chosenId : (vendedores[0]?.id ?? '')
  const [range, setRange] = useState({ from: addDays(today(), -30), to: today() })
  const [tab, setTab] = useState<Tab>('conferir')
  const [state, setState] = useState<ReviewState>('pendentes')
  const [page, setPage] = useState(1)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  // Conferências feitas com o visualizador aberto: a lista só é recarregada ao fechar (a auditoria não some da
  // tela "A conferir" logo depois de conferida)
  const [localReviews, setLocalReviews] = useState<Record<string, VendorAudit>>({})
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<unknown>(null)
  const qc = useQueryClient()

  const errors = useQuery({
    queryKey: ['audit-errors', vendedorId, range],
    queryFn: () => api<AuditErrors>('/admin/audit-errors', { query: { vendedorId, ...range } }),
    enabled: !!vendedorId,
  })
  const reviewFilters = { vendedorId, ...range, state, page, pageSize: PAGE_SIZE }
  const audits = useQuery({
    queryKey: ['vendor-audits', reviewFilters],
    queryFn: () => api<Paged<VendorAudit>>('/supervisor/vendor-audits', { query: reviewFilters }),
    enabled: !!vendedorId && tab === 'conferir',
  })
  const pending = useQuery({
    queryKey: ['vendor-audits', 'pendentes', vendedorId, range],
    queryFn: () => api<Paged<VendorAudit>>('/supervisor/vendor-audits', { query: { vendedorId, ...range, state: 'pendentes', pageSize: 1 } }),
    enabled: !!vendedorId,
  })
  const items = (audits.data?.items ?? []).map((a) => localReviews[a.id] ?? a)
  const data = errors.data

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v)
    setPage(1)
  }

  const download = async () => {
    setDownloading(true)
    setDownloadError(null)
    try {
      await downloadFile('/admin/audit-errors/pdf', { vendedorId, ...range }, 'correcoes-auditoria.pdf')
    } catch (e) {
      setDownloadError(e)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div>
      <PageHead
        title="Auditorias dos vendedores"
        description="Confira se o vendedor aprovou e reprovou certo cada foto."
        help="Confira as aprovações e reprovações que o vendedor fez nas fotos: marque cada uma como correta ou incorreta (a incorreta exige justificativa). As incorretas viram as correções do vendedor, que vão no PDF. É a mesma conferência do app do supervisor (Fotos > Vendedores)."
        actions={
          <button className="btn primary" onClick={download} disabled={!vendedorId || downloading}>
            {downloading ? 'Gerando PDF…' : 'Baixar PDF para o vendedor'}
          </button>
        }
      />
      <div className="toolbar">
        <Field label="Vendedor">
          <select className="input" value={vendedorId} onChange={(e) => resetPage(setChosenId)(e.target.value)} disabled={vendedores.length === 0}>
            {vendedores.length === 0 && <option value="">Nenhum vendedor</option>}
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <DateRange from={range.from} to={range.to} onChange={resetPage(setRange)} />
      </div>
      <ErrorBox error={downloadError ?? errors.error ?? audits.error} />
      {lookups.data && vendedores.length === 0 && (
        <Empty>
          {user?.role === 'ADMIN'
            ? 'Nenhum vendedor cadastrado.'
            : 'Nenhum vendedor ligado a você. O administrador liga os vendedores da sua equipe em Usuários, no campo Supervisor.'}
        </Empty>
      )}
      {errors.isLoading && vendedorId && <Loading />}
      {data && (
        <div className="stack">
          <section className="kpis" aria-label="Indicadores do vendedor">
            <div className="kpi">
              <span className="kpi-label">Fotos auditadas</span>
              <span className="kpi-valor tom-marinho">{data.stats.audited}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Conferidas pelo supervisor</span>
              <span className="kpi-valor tom-marinho">{data.stats.reviewed}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Auditorias incorretas</span>
              <span className="kpi-valor tom-nao-feito">{data.stats.incorrect}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Taxa de acerto</span>
              <span className="kpi-valor tom-feito">{data.stats.accuracy == null ? '—' : `${fmtNumber(data.stats.accuracy, 1)}%`}</span>
            </div>
          </section>

          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'conferir', label: `Conferir${pending.data ? ` (${pending.data.total} ${pending.data.total === 1 ? 'pendente' : 'pendentes'})` : ''}` },
              { value: 'correcoes', label: `Correções para o PDF (${data.items.length})` },
            ]}
          />

          {tab === 'conferir' && (
            <div className="stack">
              <div className="toolbar" style={{ margin: 0 }}>
                <Segmented<ReviewState>
                  value={state}
                  onChange={resetPage(setState)}
                  options={[
                    { value: 'pendentes', label: 'A conferir' },
                    { value: 'conferidas', label: 'Conferidas' },
                    { value: 'todas', label: 'Todas' },
                  ]}
                />
              </div>
              {audits.isLoading && <Loading />}
              {audits.data && items.length === 0 && (
                <Empty>{state === 'pendentes' ? 'Tudo conferido: nenhuma auditoria deste vendedor esperando conferência no período.' : 'Nenhuma auditoria no período.'}</Empty>
              )}
              <div className="photo-grid">
                {items.map((a, i) => (
                  <button key={a.id} className="photo-card" onClick={() => setOpenIndex(i)}>
                    <img src={apiUrl(a.photo.url)} alt={`${photoTypeLabel[a.photo.type]} em ${a.client.name}`} loading="lazy" />
                    <div className="photo-card-body">
                      <div className="photo-card-top">
                        <span className="chip">{photoTypeLabel[a.photo.type]}</span>
                        {a.review ? <StatusPill status={a.review.verdict} label={verdictLabel[a.review.verdict]} /> : <span className="chip">A conferir</span>}
                      </div>
                      <strong title={a.client.name}>{a.client.name}</strong>
                      <span className="muted">
                        {a.promotor.name}, {fmtDate(a.visit.date)}
                      </span>
                      <span>
                        <StatusPill status={a.status} label={`Vendedor ${a.status === 'APROVADA' ? 'aprovou' : 'reprovou'}`} />
                      </span>
                      {a.justification && (
                        <span className="muted small" title={a.justification} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          "{a.justification}"
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {audits.data && <Pager page={page} pageSize={PAGE_SIZE} total={audits.data.total} onPage={setPage} />}
            </div>
          )}

          {tab === 'correcoes' &&
            (data.items.length === 0 ? (
              <Empty>Nenhuma auditoria incorreta no período.</Empty>
            ) : (
              <section className="panel">
                <div className="panel-head">
                  <h2>Auditorias a corrigir ({data.items.length})</h2>
                </div>
                {data.items.map((item) => (
                  <article key={item.auditId} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 'var(--esp-4)', padding: 'var(--esp-4)', borderBottom: '1px solid var(--divisoria)' }}>
                    <a href={apiUrl(item.photo.url)} target="_blank" rel="noreferrer">
                      <img src={apiUrl(item.photo.url)} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 'var(--raio-selo)' }} />
                    </a>
                    <div className="stack" style={{ gap: 'var(--esp-2)' }}>
                      <h3>{item.client.name}</h3>
                      <span className="muted small">
                        {photoTypeLabel[item.photo.type]}, visita de {fmtDate(item.visitDate)} por {item.promotor}
                      </span>
                      <div>
                        Vendedor: <StatusPill status={item.vendedorStatus} label={item.vendedorStatus === 'APROVADA' ? 'Aprovou' : 'Reprovou'} />
                        {item.vendedorJustification && <span className="muted"> "{item.vendedorJustification}"</span>}
                      </div>
                      <div>
                        Correto seria: <StatusPill status={item.correctStatus} label={item.correctStatus === 'APROVADA' ? 'Aprovar' : 'Reprovar'} />
                      </div>
                      {item.supervisorComment && <div>{item.supervisorComment}</div>}
                      <span className="muted small">
                        Conferido por {item.supervisor} em {fmtDateTime(item.reviewedAt)}
                      </span>
                    </div>
                  </article>
                ))}
              </section>
            ))}
        </div>
      )}

      {openIndex != null && items[openIndex] && (
        <ReviewViewer
          // Cada auditoria abre o visualizador do zero (sem justificativa em andamento da anterior)
          key={items[openIndex].id}
          audit={items[openIndex]}
          hasPrev={openIndex > 0}
          hasNext={openIndex < items.length - 1}
          onPrev={() => setOpenIndex(openIndex - 1)}
          onNext={() => setOpenIndex(openIndex + 1)}
          onSaved={(updated) => {
            setLocalReviews((r) => ({ ...r, [updated.id]: updated }))
            qc.invalidateQueries({ queryKey: ['audit-errors'] })
            qc.invalidateQueries({ queryKey: ['vendor-audits', 'pendentes'] })
          }}
          onClose={() => {
            setOpenIndex(null)
            if (Object.keys(localReviews).length) {
              setLocalReviews({})
              qc.invalidateQueries({ queryKey: ['vendor-audits'] })
            }
          }}
        />
      )}
    </div>
  )
}

function ReviewViewer({
  audit,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onSaved,
}: {
  audit: VendorAudit
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onSaved: (audit: VendorAudit) => void
}) {
  const [marking, setMarking] = useState(false)
  const [comment, setComment] = useState('')
  const [saved, setSaved] = useState<ReviewVerdict | null>(null)

  const save = useMutation({
    mutationFn: (verdict: ReviewVerdict) =>
      api<VendorAudit>(`/supervisor/vendor-audits/${audit.id}/review`, {
        method: 'POST',
        body: { verdict, comment: verdict === 'INCORRETA' ? comment.trim() : undefined },
      }),
    onSuccess: (updated, verdict) => {
      onSaved(updated)
      // Depois de conferir, passa para a próxima; na última, fica nela mostrando o que foi gravado
      if (hasNext) onNext()
      else {
        setMarking(false)
        setSaved(verdict)
      }
    },
  })

  const canMark = comment.trim().length >= MIN_JUSTIFICATION
  const markCorrect = () => !save.isPending && save.mutate('CORRETA')
  const confirmIncorrect = () => canMark && !save.isPending && save.mutate('INCORRETA')
  const startIncorrect = () => {
    setComment(audit.review?.verdict === 'INCORRETA' ? (audit.review.comment ?? '') : '')
    setMarking(true)
  }

  useViewerKeys({
    ArrowRight: hasNext && onNext,
    ArrowLeft: hasPrev && onPrev,
    c: !marking && markCorrect,
    i: !marking && startIncorrect,
  })

  const shouldBe = audit.status === 'APROVADA' ? 'reprovada' : 'aprovada'
  return (
    <Modal
      wide
      title={`${photoTypeLabel[audit.photo.type]} em ${audit.client.name}`}
      onClose={onClose}
      footer={
        <>
          <NavArrows onPrev={onPrev} onNext={onNext} hasPrev={hasPrev} hasNext={hasNext} />
          <span className="flex-1" />
          {saved && <span className="muted small">Conferida como {verdictLabel[saved].toLowerCase()}.</span>}
          {marking ? (
            <>
              <button className="btn" onClick={() => setMarking(false)} disabled={save.isPending}>
                Cancelar
              </button>
              <button className="btn reject" onClick={confirmIncorrect} disabled={!canMark || save.isPending}>
                {save.isPending ? 'Gravando…' : 'Confirmar incorreta'}
              </button>
              {!canMark && <span className="btn-hint">Escreva pelo menos {MIN_JUSTIFICATION} caracteres</span>}
            </>
          ) : (
            <>
              <button className="btn reject" onClick={startIncorrect} disabled={save.isPending}>
                Incorreta <Shortcut k="I" />
              </button>
              <button className="btn approve" onClick={markCorrect} disabled={save.isPending}>
                {save.isPending ? 'Gravando…' : <>Correta <Shortcut k="C" /></>}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="viewer">
        <a href={apiUrl(audit.photo.url)} target="_blank" rel="noreferrer" title="Abrir em tamanho original">
          <img src={apiUrl(audit.photo.url)} alt={`${photoTypeLabel[audit.photo.type]} em ${audit.client.name}`} />
        </a>
        <div className="stack">
          <PhotoFacts client={audit.client} promotor={audit.promotor} takenAt={audit.photo.takenAt} meta={audit.photo.meta} notes={audit.photo.notes} products={audit.photo.products} />

          <div className="stack" style={{ gap: 'var(--esp-2)' }}>
            <h3>Auditoria do vendedor</h3>
            <div className="small">
              <StatusPill status={audit.status} label={auditLabel[audit.status]} /> por {audit.vendedor.name} em {fmtDateTime(audit.createdAt)}
              {audit.justification && <div className="muted">"{audit.justification}"</div>}
            </div>
          </div>

          <div className="stack" style={{ gap: 'var(--esp-2)' }}>
            <h3>Conferência</h3>
            {audit.review ? (
              <div className="small">
                <StatusPill status={audit.review.verdict} label={verdictLabel[audit.review.verdict]} /> por {audit.review.supervisor.name} em {fmtDateTime(audit.review.createdAt)}
                {audit.review.comment && <div className="muted">{audit.review.comment}</div>}
                {!marking && <div className="muted">Pode alterar com os botões abaixo.</div>}
              </div>
            ) : (
              !marking && <span className="muted small">Ainda não conferida. Correta: o vendedor decidiu certo. Incorreta: a foto deveria ser {shouldBe}.</span>
            )}
            {marking && (
              <JustificationBox
                label={`O que o vendedor errou? (a foto deveria ser ${shouldBe})`}
                value={comment}
                onChange={setComment}
                onSubmit={confirmIncorrect}
                placeholder={audit.status === 'APROVADA' ? 'Ex.: há ruptura na segunda prateleira e a foto não mostra a frente dos produtos' : 'Ex.: a foto está nítida e mostra a gôndola completa'}
                hint="Vai no PDF de correções para o vendedor."
              />
            )}
            {!marking && <span className="muted small">Depois de conferir, abre a próxima.</span>}
          </div>
          <ErrorBox error={save.error} />
        </div>
      </div>
    </Modal>
  )
}
