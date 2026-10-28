import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, apiUrl, downloadFile } from '../api'
import { addDays, fmtDate, fmtDateTime, fmtNumber, photoTypeLabel, today } from '../format'
import type { AuditErrors } from '../types'
import { DateRange, Empty, ErrorBox, Field, Loading, PageHead, StatusPill, useLookups } from '../ui'

export function AuditErrorsPage() {
  const lookups = useLookups()
  const [vendedorId, setVendedorId] = useState('')
  const [range, setRange] = useState({ from: addDays(today(), -30), to: today() })
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<unknown>(null)
  useEffect(() => {
    if (!vendedorId && lookups.data?.vendedores[0]) setVendedorId(lookups.data.vendedores[0].id)
  }, [lookups.data, vendedorId])

  const query = useQuery({
    queryKey: ['audit-errors', vendedorId, range],
    queryFn: () => api<AuditErrors>('/admin/audit-errors', { query: { vendedorId, ...range } }),
    enabled: !!vendedorId,
  })
  const data = query.data

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
        title="Correções de auditoria"
        description="Auditorias de fotos que o vendedor fez e que o supervisor marcou como incorretas. Gere o PDF para enviar ao vendedor."
        actions={
          <button className="btn accent" onClick={download} disabled={!vendedorId || downloading}>
            {downloading ? 'Gerando PDF…' : 'Baixar PDF para o vendedor'}
          </button>
        }
      />
      <div className="toolbar">
        <Field label="Vendedor">
          <select className="input" value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
            <option value="">Escolha o vendedor</option>
            {lookups.data?.vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <DateRange from={range.from} to={range.to} onChange={setRange} />
      </div>
      <ErrorBox error={downloadError ?? query.error} />
      {!vendedorId && <Empty>Escolha um vendedor para ver as correções do período.</Empty>}
      {query.isLoading && vendedorId && <Loading />}
      {data && (
        <div className="stack">
          <section className="tags" aria-label="Indicadores do vendedor">
            <div className="shelf-tag alt">
              <span className="tag-label">Fotos auditadas</span>
              <span className="tag-value num">{data.stats.audited}</span>
            </div>
            <div className="shelf-tag alt">
              <span className="tag-label">Conferidas pelo supervisor</span>
              <span className="tag-value num">{data.stats.reviewed}</span>
            </div>
            <div className="shelf-tag alt">
              <span className="tag-label">Auditorias incorretas</span>
              <span className="tag-value num" style={{ color: data.stats.incorrect ? 'var(--notdone)' : undefined }}>
                {data.stats.incorrect}
              </span>
            </div>
            <div className="shelf-tag">
              <span className="tag-label">Taxa de acerto</span>
              <span className="tag-value num">{data.stats.accuracy == null ? '—' : `${fmtNumber(data.stats.accuracy, 1)}%`}</span>
            </div>
          </section>

          {data.items.length === 0 ? (
            <Empty>Nenhuma auditoria incorreta no período.</Empty>
          ) : (
            <section className="panel">
              <div className="panel-head">
                <h2>Auditorias a corrigir ({data.items.length})</h2>
              </div>
              {data.items.map((item) => (
                <article key={item.auditId} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, padding: 16, borderBottom: '1px solid var(--rule)' }}>
                  <a href={apiUrl(item.photo.url)} target="_blank" rel="noreferrer">
                    <img src={apiUrl(item.photo.url)} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 4 }} />
                  </a>
                  <div className="stack" style={{ gap: 6 }}>
                    <h3>
                      {item.client.code ? `${item.client.code} · ` : ''}
                      {item.client.name}
                    </h3>
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
          )}
        </div>
      )}
    </div>
  )
}
