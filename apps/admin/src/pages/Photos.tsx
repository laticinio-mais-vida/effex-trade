import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { api, apiUrl } from '../api'
import { addDays, fmtDate, fmtDateTime, photoTypeLabel, today } from '../format'
import type { Paged, PhotoItem, PhotoType, SettingsResponse } from '../types'
import { DateRange, Empty, ErrorBox, Field, Loading, Modal, PageHead, Pager, PromotorSelect, Segmented, StatusPill } from '../ui'

type Reviewed = 'pendentes' | 'avaliadas' | 'todas'
const PAGE_SIZE = 48

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

export function PhotosPage() {
  const [range, setRange] = useState({ from: addDays(today(), -6), to: today() })
  const [promotorId, setPromotorId] = useState('')
  const [type, setType] = useState<PhotoType | ''>('')
  const [reviewed, setReviewed] = useState<Reviewed>('pendentes')
  const [page, setPage] = useState(1)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  // Notas salvas com o visualizador aberto: a lista só é recarregada ao fechar, para a foto não
  // sumir da tela (no filtro "Sem nota") logo depois de salvar
  const [localReviews, setLocalReviews] = useState<Record<string, Pick<PhotoItem, 'score' | 'reviewNotes'>>>({})
  const qc = useQueryClient()

  const filters = { ...range, promotorId, type, reviewed: reviewed === 'todas' ? undefined : reviewed === 'avaliadas', page, pageSize: PAGE_SIZE }
  const query = useQuery({
    queryKey: ['photos', filters],
    queryFn: () => api<Paged<PhotoItem>>('/admin/photos', { query: filters }),
  })
  const items = (query.data?.items ?? []).map((p) => (localReviews[p.id] ? { ...p, ...localReviews[p.id] } : p))
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v)
    setPage(1)
  }

  return (
    <div>
      <PageHead title="Avaliar fotos" description="Veja as fotos dos atendimentos, dê uma nota e registre observações. As decisões dos vendedores aparecem ao lado da foto." />
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
        <Segmented<Reviewed>
          value={reviewed}
          onChange={resetPage(setReviewed)}
          options={[
            { value: 'pendentes', label: 'Sem nota' },
            { value: 'avaliadas', label: 'Avaliadas' },
            { value: 'todas', label: 'Todas' },
          ]}
        />
      </div>
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />
      {query.data && items.length === 0 && <Empty>{reviewed === 'pendentes' ? 'Todas as fotos do período já têm nota.' : 'Nenhuma foto no período.'}</Empty>}
      <div className="photo-grid">
        {items.map((p, i) => (
          <button key={p.id} className="photo-card" onClick={() => setOpenIndex(i)}>
            <img src={apiUrl(p.url)} alt={`${photoTypeLabel[p.type]} em ${p.client.name}`} loading="lazy" />
            <div className="photo-card-body">
              <div className="photo-card-top">
                <span className="chip">{photoTypeLabel[p.type]}</span>
                {p.score != null && <span className="score num">{p.score}</span>}
              </div>
              <strong title={p.client.name}>{p.client.name}</strong>
              <span className="muted">
                {p.promotor.name}, {fmtDate(p.visit.date)}
              </span>
              {p.audits.length > 0 && (
                <span className="btn-row" style={{ gap: 4 }}>
                  {p.audits.map((a) => (
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
          photo={items[openIndex]}
          hasPrev={openIndex > 0}
          hasNext={openIndex < items.length - 1}
          onPrev={() => setOpenIndex(openIndex - 1)}
          onNext={() => setOpenIndex(openIndex + 1)}
          onSaved={(id, review) => setLocalReviews((r) => ({ ...r, [id]: review }))}
          onClose={() => {
            setOpenIndex(null)
            if (Object.keys(localReviews).length) {
              setLocalReviews({})
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
  onSaved: (id: string, review: Pick<PhotoItem, 'score' | 'reviewNotes'>) => void
}) {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/admin/settings') })
  const max = Number(settings.data?.values.photoScoreMax ?? 10)
  const [score, setScore] = useState<number | null>(photo.score)
  const [notes, setNotes] = useState(photo.reviewNotes ?? '')
  const [saved, setSaved] = useState(false)

  // Recarrega o formulário só ao trocar de foto (salvar não pode apagar o aviso de "salva")
  useEffect(() => {
    setScore(photo.score)
    setNotes(photo.reviewNotes ?? '')
    setSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id])

  const save = useMutation({
    mutationFn: () => api(`/admin/photos/${photo.id}/review`, { method: 'PATCH', body: { score, notes: notes || null } }),
    onSuccess: () => {
      setSaved(true)
      onSaved(photo.id, { score, reviewNotes: notes || null })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const saveAndNext = useCallback(async () => {
    await save.mutateAsync()
    if (hasNext) onNext()
  }, [save, hasNext, onNext])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight' && hasNext) onNext()
      if (e.key === 'ArrowLeft' && hasPrev) onPrev()
      if (/^[0-9]$/.test(e.key) && Number(e.key) <= max) setScore(Number(e.key))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasNext, hasPrev, onNext, onPrev, max])

  const meta = Object.entries(photo.meta ?? {})
  return (
    <Modal
      wide
      title={`${photoTypeLabel[photo.type]} em ${photo.client.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onPrev} disabled={!hasPrev}>
            Anterior
          </button>
          <button className="btn" onClick={onNext} disabled={!hasNext}>
            Próxima
          </button>
          <span style={{ flex: 1 }} />
          {saved && <span className="muted small">Avaliação salva</span>}
          <button className="btn" onClick={() => save.mutate()} disabled={save.isPending}>
            Salvar avaliação
          </button>
          <button className="btn primary" onClick={saveAndNext} disabled={save.isPending || !hasNext}>
            Salvar e ir para a próxima
          </button>
        </>
      }
    >
      <div className="viewer">
        <a href={apiUrl(photo.url)} target="_blank" rel="noreferrer" title="Abrir em tamanho original">
          <img src={apiUrl(photo.url)} alt={`${photoTypeLabel[photo.type]} em ${photo.client.name}`} />
        </a>
        <div className="stack">
          <dl className="kv">
            <dt>Cliente</dt>
            <dd>
              {photo.client.name}
              {photo.client.city ? `, ${photo.client.city}` : ''}
            </dd>
            <dt>Promotor</dt>
            <dd>{photo.promotor.name}</dd>
            <dt>Tirada em</dt>
            <dd>{fmtDateTime(photo.takenAt)}</dd>
            {photo.task && (
              <>
                <dt>Atividade</dt>
                <dd>{photo.task.title}</dd>
              </>
            )}
            {meta.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{metaLabels[k] ?? k}</dt>
                <dd style={k === 'avisoIntervaloCurto' ? { color: 'var(--justified)', fontWeight: 600 } : undefined}>{metaValue(k, v)}</dd>
              </div>
            ))}
            {photo.notes && (
              <>
                <dt>Observação</dt>
                <dd>{photo.notes}</dd>
              </>
            )}
            {!!photo.products?.length && (
              <>
                <dt>Produtos na foto</dt>
                <dd>{photo.products.map((p) => p.name).join(', ')}</dd>
              </>
            )}
          </dl>

          {photo.audits.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <h3>Auditorias</h3>
              {photo.audits.map((a) => (
                <div key={a.id} className="small">
                  <StatusPill status={a.status} label={a.status === 'APROVADA' ? 'Aprovada' : 'Reprovada'} /> por {a.auditor.name}
                  {a.justification && <div className="muted">"{a.justification}"</div>}
                  {a.review && (
                    <div>
                      Conferida pelo supervisor: <StatusPill status={a.review.verdict} label={a.review.verdict === 'CORRETA' ? 'correta' : 'incorreta'} />
                      {a.review.comment && <span className="muted"> {a.review.comment}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="stack" style={{ gap: 8 }}>
            <h3>Nota</h3>
            <div className="score-picker" role="group" aria-label="Nota da foto">
              {Array.from({ length: max + 1 }, (_, n) => (
                <button key={n} className={score === n ? 'on' : ''} aria-pressed={score === n} onClick={() => setScore(score === n ? null : n)}>
                  {n}
                </button>
              ))}
            </div>
            <span className="muted small">Atalhos: teclas 0 a 9 para a nota, setas para navegar.</span>
          </div>
          <Field label="Observações">
            <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: produtos sem frente, preço não aparece" />
          </Field>
          {photo.reviewedBy && (
            <span className="muted small">
              Última avaliação por {photo.reviewedBy.name} em {fmtDateTime(photo.reviewedAt)}
            </span>
          )}
          <ErrorBox error={save.error} />
        </div>
      </div>
    </Modal>
  )
}
