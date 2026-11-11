import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, apiUrl } from '../api'
import { AuditList, JustificationBox, PhotoFacts } from '../audit'
import { MIN_JUSTIFICATION, useViewerKeys } from '../audit-labels'
import { fmtDate, fmtDateTime, photoTypeLabel } from '../format'
import type { Contest, ContestStatus, Paged } from '../types'
import { Empty, ErrorBox, Loading, Modal, NavArrows, PageHead, Pager, PromotorSelect, Segmented, Shortcut, StatusPill } from '../ui'

type State = 'pendentes' | 'decididas' | 'todas'
type Decision = 'ACEITA' | 'NEGADA'
const PAGE_SIZE = 48

export function ContestStatusTag({ status }: { status: ContestStatus }) {
  if (status === 'PENDENTE') return <span className="chip">Aguardando decisão</span>
  return <StatusPill status={status === 'ACEITA' ? 'APROVADA' : 'REPROVADA'} label={status === 'ACEITA' ? 'Aceita' : 'Negada'} />
}

export function ContestsPage() {
  const [promotorId, setPromotorId] = useState('')
  const [state, setState] = useState<State>('pendentes')
  const [page, setPage] = useState(1)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  // Decisões tomadas com o visualizador aberto: a lista só é recarregada ao fechar (a contestação não some da
  // tela "Pendentes" logo depois de decidida)
  const [local, setLocal] = useState<Record<string, Contest>>({})
  const qc = useQueryClient()

  const filters = { promotorId, state, page, pageSize: PAGE_SIZE }
  const query = useQuery({
    queryKey: ['contests', filters],
    queryFn: () => api<Paged<Contest>>('/supervisor/contests', { query: filters }),
  })
  const items = (query.data?.items ?? []).map((c) => local[c.id] ?? c)
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v)
    setPage(1)
  }

  return (
    <div>
      <PageHead
        title="Contestações"
        description="Fotos reprovadas que os promotores contestaram pelo app."
        help="Fotos reprovadas que os promotores contestaram pelo app (até 2 por dia, com explicação). Aceitar: a foto passa a valer como aprovada; a reprovação do vendedor fica conferida como incorreta (entra no PDF de correções dele) e a do supervisor ou do administrador vira aprovação. Negar: a reprovação continua e o promotor vê a sua resposta. É a mesma lista da aba Contestações do app do supervisor."
      />
      <div className="toolbar">
        <PromotorSelect value={promotorId} onChange={resetPage(setPromotorId)} />
        <Segmented<State>
          value={state}
          onChange={resetPage(setState)}
          options={[
            { value: 'pendentes', label: 'Aguardando decisão' },
            { value: 'decididas', label: 'Decididas' },
            { value: 'todas', label: 'Todas' },
          ]}
        />
      </div>
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />
      {query.data && items.length === 0 && <Empty>{state === 'pendentes' ? 'Nenhuma contestação esperando decisão.' : 'Nenhuma contestação.'}</Empty>}
      <div className="photo-grid">
        {items.map((c, i) => (
          <button key={c.id} className="photo-card" onClick={() => setOpenIndex(i)}>
            <img src={apiUrl(c.photo.url)} alt={`${photoTypeLabel[c.photo.type]} em ${c.client.name}`} loading="lazy" />
            <div className="photo-card-body">
              <div className="photo-card-top">
                <span className="chip">{photoTypeLabel[c.photo.type]}</span>
                <ContestStatusTag status={c.status} />
              </div>
              <strong title={c.client.name}>{c.client.name}</strong>
              <span className="muted">
                {c.promotor.name}, {fmtDate(c.visit.date)}
              </span>
              <span className="muted small" title={c.reason} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                "{c.reason}"
              </span>
            </div>
          </button>
        ))}
      </div>
      {query.data && <Pager page={page} pageSize={PAGE_SIZE} total={query.data.total} onPage={setPage} />}
      {openIndex != null && items[openIndex] && (
        <ContestViewer
          // Cada contestação abre o visualizador do zero (sem resposta em andamento da anterior)
          key={items[openIndex].id}
          contest={items[openIndex]}
          hasPrev={openIndex > 0}
          hasNext={openIndex < items.length - 1}
          onPrev={() => setOpenIndex(openIndex - 1)}
          onNext={() => setOpenIndex(openIndex + 1)}
          onSaved={(updated) => {
            setLocal((r) => ({ ...r, [updated.id]: updated }))
            qc.invalidateQueries({ queryKey: ['dashboard'] })
            // A aceitação muda auditorias: as telas de fotos e de correções recarregam quando abertas
            qc.invalidateQueries({ queryKey: ['photos'] })
            qc.invalidateQueries({ queryKey: ['audit-errors'] })
            qc.invalidateQueries({ queryKey: ['vendor-audits'] })
          }}
          onClose={() => {
            setOpenIndex(null)
            if (Object.keys(local).length) {
              setLocal({})
              qc.invalidateQueries({ queryKey: ['contests'] })
            }
          }}
        />
      )}
    </div>
  )
}

function ContestViewer({
  contest,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onSaved,
}: {
  contest: Contest
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onSaved: (contest: Contest) => void
}) {
  const [denying, setDenying] = useState(false)
  const [response, setResponse] = useState('')
  const [saved, setSaved] = useState<Decision | null>(null)

  const save = useMutation({
    mutationFn: (decision: Decision) =>
      api<Contest>(`/supervisor/contests/${contest.id}/decide`, {
        method: 'POST',
        body: { decision, response: decision === 'NEGADA' ? response.trim() : undefined },
      }),
    onSuccess: (updated, decision) => {
      onSaved(updated)
      // Depois de decidir, passa para a próxima; na última, fica nela mostrando o que foi gravado
      if (hasNext) onNext()
      else {
        setDenying(false)
        setSaved(decision)
      }
    },
  })

  const pending = contest.status === 'PENDENTE'
  const canDeny = response.trim().length >= MIN_JUSTIFICATION
  const accept = () => pending && !save.isPending && save.mutate('ACEITA')
  const confirmDeny = () => canDeny && !save.isPending && save.mutate('NEGADA')

  useViewerKeys({
    ArrowRight: hasNext && onNext,
    ArrowLeft: hasPrev && onPrev,
    a: pending && !denying && accept,
    n: pending && !denying && (() => setDenying(true)),
  })

  return (
    <Modal
      wide
      title={`${photoTypeLabel[contest.photo.type]} em ${contest.client.name}`}
      onClose={onClose}
      footer={
        <>
          <NavArrows onPrev={onPrev} onNext={onNext} hasPrev={hasPrev} hasNext={hasNext} />
          <span className="flex-1" />
          {saved && <span className="muted small">Contestação {saved === 'ACEITA' ? 'aceita: a foto vale como aprovada' : 'negada'}.</span>}
          {pending &&
            (denying ? (
              <>
                <button className="btn" onClick={() => setDenying(false)} disabled={save.isPending}>
                  Cancelar
                </button>
                <button className="btn reject" onClick={confirmDeny} disabled={!canDeny || save.isPending}>
                  {save.isPending ? 'Gravando…' : 'Confirmar negação'}
                </button>
                {!canDeny && <span className="btn-hint">Escreva pelo menos {MIN_JUSTIFICATION} caracteres</span>}
              </>
            ) : (
              <>
                <button className="btn reject" onClick={() => setDenying(true)} disabled={save.isPending}>
                  Negar <Shortcut k="N" />
                </button>
                <button className="btn approve" onClick={accept} disabled={save.isPending}>
                  {save.isPending ? 'Gravando…' : <>Aceitar <Shortcut k="A" /></>}
                </button>
              </>
            ))}
        </>
      }
    >
      <div className="viewer">
        <a href={apiUrl(contest.photo.url)} target="_blank" rel="noreferrer" title="Abrir em tamanho original">
          <img src={apiUrl(contest.photo.url)} alt={`${photoTypeLabel[contest.photo.type]} em ${contest.client.name}`} />
        </a>
        <div className="stack">
          <PhotoFacts
            client={contest.client}
            promotor={contest.promotor}
            takenAt={contest.photo.takenAt}
            meta={contest.photo.meta}
            notes={contest.photo.notes}
            products={contest.photo.products}
          />
          <AuditList audits={contest.audits} />

          <div className="stack" style={{ gap: 'var(--esp-2)' }}>
            <h3>Contestação do promotor</h3>
            <div className="small">
              <ContestStatusTag status={contest.status} /> enviada em {fmtDateTime(contest.createdAt)}
              <div>"{contest.reason}"</div>
            </div>
            {!pending && (
              <div className="small">
                {contest.status === 'ACEITA' ? 'Aceita' : 'Negada'} por {contest.decidedBy?.name ?? '—'} em {fmtDateTime(contest.decidedAt)}
                {contest.response && <div className="muted">{contest.response}</div>}
              </div>
            )}
            {pending && denying && (
              <JustificationBox
                label="Por que a reprovação continua? (o promotor vê esta resposta)"
                value={response}
                onChange={setResponse}
                onSubmit={confirmDeny}
                placeholder="Ex.: a foto não mostra a gôndola inteira; tire de mais longe"
              />
            )}
            {pending && !denying && (
              <span className="muted small">Aceitar aprova a foto. Negar exige uma resposta ao promotor.</span>
            )}
          </div>
          <ErrorBox error={save.error} />
        </div>
      </div>
    </Modal>
  )
}
