import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, apiUrl } from '../api'
import { AuditList, JustificationBox, PhotoFacts } from '../audit'
import { auditLabel, MIN_JUSTIFICATION, useViewerKeys } from '../audit-labels'
import { addDays, fmtDate, fmtDateTime, photoTypeLabel, today } from '../format'
import type { AuditStatus, Paged, PhotoItem, PhotoType } from '../types'
import { DateRange, Empty, ErrorBox, Field, Loading, Modal, NavArrows, PageHead, Pager, PromotorSelect, Segmented, Shortcut, StatusPill } from '../ui'

type AuditFilter = 'pendentes' | 'auditadas' | 'todas'
const PAGE_SIZE = 48

export function PhotosPage() {
  const [range, setRange] = useState({ from: addDays(today(), -6), to: today() })
  const [promotorId, setPromotorId] = useState('')
  const [type, setType] = useState<PhotoType | ''>('')
  const [status, setStatus] = useState<AuditFilter>('pendentes')
  const [page, setPage] = useState(1)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  // Fotos auditadas com o visualizador aberto: a lista só é recarregada ao fechar, para a foto não
  // sumir da tela (no filtro "Pendentes") logo depois de aprovar ou reprovar
  const [localAudits, setLocalAudits] = useState<Record<string, PhotoItem>>({})
  const qc = useQueryClient()

  const filters = { ...range, promotorId, type, status, page, pageSize: PAGE_SIZE }
  const query = useQuery({
    queryKey: ['photos', filters],
    queryFn: () => api<Paged<PhotoItem>>('/admin/photos', { query: filters }),
  })
  const items = (query.data?.items ?? []).map((p) => localAudits[p.id] ?? p)
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v)
    setPage(1)
  }

  return (
    <div>
      <PageHead
        title="Avaliar fotos"
        description="Aprove ou reprove as fotos dos atendimentos; a reprovação exige justificativa. É a mesma auditoria do app do supervisor (aba Auditoria de fotos): o que você decide aqui aparece lá, e vice-versa. As decisões dos vendedores aparecem junto da foto."
      />
      <div className="toolbar">
        <DateRange from={range.from} to={range.to} onChange={resetPage(setRange)} />
        <PromotorSelect value={promotorId} onChange={resetPage(setPromotorId)} />
        <Field label="Tipo">
          <select className="input" value={type} onChange={(e) => resetPage(setType)(e.target.value as PhotoType | '')}>
            <option value="">Todos os tipos</option>
            {Object.entries(photoTypeLabel).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Segmented<AuditFilter>
          value={status}
          onChange={resetPage(setStatus)}
          options={[
            { value: 'pendentes', label: 'Pendentes' },
            { value: 'auditadas', label: 'Auditadas por você' },
            { value: 'todas', label: 'Todas' },
          ]}
        />
      </div>
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />
      {query.data && items.length === 0 && (
        <Empty>{status === 'pendentes' ? 'Você já aprovou ou reprovou todas as fotos do período.' : 'Nenhuma foto no período.'}</Empty>
      )}
      <div className="photo-grid">
        {items.map((p, i) => (
          <button key={p.id} className="photo-card" onClick={() => setOpenIndex(i)}>
            <img src={apiUrl(p.url)} alt={`${photoTypeLabel[p.type]} em ${p.client.name}`} loading="lazy" />
            <div className="photo-card-body">
              <div className="photo-card-top">
                <span className="chip">{photoTypeLabel[p.type]}</span>
                {p.myAudit ? <StatusPill status={p.myAudit.status} label={`Você: ${auditLabel[p.myAudit.status].toLowerCase()}`} /> : <span className="chip">Pendente</span>}
              </div>
              <strong title={p.client.name}>{p.client.name}</strong>
              <span className="muted">
                {p.promotor.name}, {fmtDate(p.visit.date)}
              </span>
              {p.audits.some((a) => a.id !== p.myAudit?.id) && (
                <span className="btn-row" style={{ gap: 'var(--esp-1)' }}>
                  {p.audits
                    .filter((a) => a.id !== p.myAudit?.id)
                    .map((a) => (
                      <StatusPill key={a.id} status={a.status} label={`${a.auditor.name.split(' ')[0]}: ${a.status === 'APROVADA' ? 'aprovou' : 'reprovou'}`} />
                    ))}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
      {query.data && <Pager page={page} pageSize={PAGE_SIZE} total={query.data.total} onPage={setPage} />}
      {openIndex != null && items[openIndex] && (
        <PhotoViewer
          // Cada foto abre o visualizador do zero (sem reprovação em andamento da anterior)
          key={items[openIndex].id}
          photo={items[openIndex]}
          hasPrev={openIndex > 0}
          hasNext={openIndex < items.length - 1}
          onPrev={() => setOpenIndex(openIndex - 1)}
          onNext={() => setOpenIndex(openIndex + 1)}
          onSaved={(updated) => {
            setLocalAudits((r) => ({ ...r, [updated.id]: updated }))
            qc.invalidateQueries({ queryKey: ['dashboard'] })
          }}
          onClose={() => {
            setOpenIndex(null)
            if (Object.keys(localAudits).length) {
              setLocalAudits({})
              qc.invalidateQueries({ queryKey: ['photos'] })
            }
          }}
        />
      )}
    </div>
  )
}

function PhotoViewer({
  photo,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onSaved,
}: {
  photo: PhotoItem
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onSaved: (photo: PhotoItem) => void
}) {
  const [rejecting, setRejecting] = useState(false)
  const [justification, setJustification] = useState('')
  const [saved, setSaved] = useState<AuditStatus | null>(null)

  const save = useMutation({
    mutationFn: (status: AuditStatus) =>
      api<PhotoItem>(`/admin/photos/${photo.id}/audit`, { method: 'POST', body: { status, justification: status === 'REPROVADA' ? justification.trim() : undefined } }),
    onSuccess: (updated, status) => {
      onSaved(updated)
      // Depois de decidir, passa para a próxima foto; na última, fica nela mostrando o que foi gravado
      if (hasNext) onNext()
      else {
        setRejecting(false)
        setSaved(status)
      }
    },
  })

  const canReject = justification.trim().length >= MIN_JUSTIFICATION
  const approve = () => !save.isPending && save.mutate('APROVADA')
  const confirmReject = () => canReject && !save.isPending && save.mutate('REPROVADA')
  const startReject = () => {
    setJustification(photo.myAudit?.status === 'REPROVADA' ? (photo.myAudit.justification ?? '') : '')
    setRejecting(true)
  }

  useViewerKeys({
    ArrowRight: hasNext && onNext,
    ArrowLeft: hasPrev && onPrev,
    a: !rejecting && approve,
    r: !rejecting && startReject,
  })

  const others = photo.audits.filter((a) => a.id !== photo.myAudit?.id)
  const mine = photo.myAudit
  return (
    <Modal
      wide
      title={`${photoTypeLabel[photo.type]} em ${photo.client.name}`}
      onClose={onClose}
      footer={
        <>
          <NavArrows onPrev={onPrev} onNext={onNext} hasPrev={hasPrev} hasNext={hasNext} />
          <span className="flex-1" />
          {saved && <span className="muted small">Foto {auditLabel[saved].toLowerCase()}.</span>}
          {rejecting ? (
            <>
              <button className="btn" onClick={() => setRejecting(false)} disabled={save.isPending}>
                Cancelar
              </button>
              <button className="btn reject" onClick={confirmReject} disabled={!canReject || save.isPending}>
                {save.isPending ? 'Gravando…' : 'Confirmar reprovação'}
              </button>
              {!canReject && <span className="btn-hint">Escreva pelo menos {MIN_JUSTIFICATION} caracteres</span>}
            </>
          ) : (
            <>
              <button className="btn reject" onClick={startReject} disabled={save.isPending}>
                Reprovar <Shortcut k="R" />
              </button>
              <button className="btn approve" onClick={approve} disabled={save.isPending}>
                {save.isPending ? 'Gravando…' : <>Aprovar <Shortcut k="A" /></>}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="viewer">
        <a href={apiUrl(photo.url)} target="_blank" rel="noreferrer" title="Abrir em tamanho original">
          <img src={apiUrl(photo.url)} alt={`${photoTypeLabel[photo.type]} em ${photo.client.name}`} />
        </a>
        <div className="stack">
          <PhotoFacts client={photo.client} promotor={photo.promotor} takenAt={photo.takenAt} task={photo.task} meta={photo.meta} notes={photo.notes} products={photo.products} />
          <AuditList audits={others} title="Auditorias de outras pessoas" />

          <div className="stack" style={{ gap: 'var(--esp-2)' }}>
            <h3>Sua auditoria</h3>
            {mine ? (
              <div className="small">
                <StatusPill status={mine.status} label={auditLabel[mine.status]} /> em {fmtDateTime(mine.updatedAt)}
                {mine.justification && <div className="muted">"{mine.justification}"</div>}
                {!rejecting && <div className="muted">Pode alterar com os botões abaixo.</div>}
              </div>
            ) : (
              !rejecting && <span className="muted small">Ainda não aprovada nem reprovada por você.</span>
            )}
            {rejecting && (
              <JustificationBox
                label="Por que a foto está reprovada?"
                value={justification}
                onChange={setJustification}
                onSubmit={confirmReject}
                placeholder="Ex.: foto escura, gôndola desorganizada, preço não aparece"
              />
            )}
            {!rejecting && <span className="muted small">Depois de decidir, abre a próxima foto.</span>}
          </div>
          <ErrorBox error={save.error} />
        </div>
      </div>
    </Modal>
  )
}
