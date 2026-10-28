import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import type { Lookups } from '../types'
import { ErrorBox, Loading, PageHead } from '../ui'

type Reason = Lookups['reasons'][number]

export function ReasonsPage() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const query = useQuery({ queryKey: ['reasons'], queryFn: () => api<Reason[]>('/admin/reasons') })
  const [label, setLabel] = useState('')

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['reasons'] })
    qc.invalidateQueries({ queryKey: ['lookups'] })
  }
  const create = useMutation({
    mutationFn: () => api('/admin/reasons', { method: 'POST', body: { label, position: (query.data?.length ?? 0) + 1 } }),
    onSuccess: () => {
      setLabel('')
      invalidate()
    },
  })
  const update = useMutation({
    mutationFn: ({ id, ...body }: Partial<Reason> & { id: string }) => api(`/admin/reasons/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  })

  return (
    <div style={{ maxWidth: 760 }}>
      <PageHead title="Motivos de justificativa" description="Lista que o promotor escolhe ao justificar um cliente não atendido. Motivos desativados deixam de aparecer no app, mas continuam nos relatórios." />
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error ?? create.error ?? update.error} />
      <section className="panel">
        {isAdmin && (
          <form
            className="panel-head"
            onSubmit={(e) => {
              e.preventDefault()
              if (label.trim().length >= 2) create.mutate()
            }}
          >
            <input className="input" style={{ flex: 1 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Novo motivo, ex.: Gerente ausente" />
            <button className="btn primary" disabled={label.trim().length < 2 || create.isPending}>
              Adicionar motivo
            </button>
          </form>
        )}
        <table className="data">
          <tbody>
            {query.data?.map((r) => (
              <tr key={r.id}>
                <td style={{ verticalAlign: 'middle' }}>
                  {isAdmin ? (
                    <input
                      className="input"
                      style={{ width: '100%' }}
                      defaultValue={r.label}
                      onBlur={(e) => e.target.value.trim() !== r.label && e.target.value.trim().length >= 2 && update.mutate({ id: r.id, label: e.target.value.trim() })}
                    />
                  ) : (
                    r.label
                  )}
                </td>
                <td style={{ width: 160, verticalAlign: 'middle' }}>
                  {isAdmin ? (
                    <label className="check">
                      <input type="checkbox" checked={r.active} onChange={(e) => update.mutate({ id: r.id, active: e.target.checked })} />
                      {r.active ? 'Ativo' : 'Desativado'}
                    </label>
                  ) : r.active ? (
                    'Ativo'
                  ) : (
                    'Desativado'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
