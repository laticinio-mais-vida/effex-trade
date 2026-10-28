import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api'
import { addDays, fmtDate, today } from '../format'
import type { Client, Task } from '../types'
import { ClientPicker, Empty, ErrorBox, Field, Loading, Modal, PageHead, useLookups } from '../ui'

export function TasksPage() {
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const query = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/admin/tasks') })
  const t0 = today()

  return (
    <div>
      <PageHead
        title="Atividades extras"
        description="Tarefas pedidas ao promotor além do roteiro, como montar uma ponta de gôndola de campanha. Aparecem no app durante o atendimento; podem exigir foto ou só a confirmação do promotor, e podem ser obrigatórias para encerrar o atendimento."
        actions={
          <button className="btn primary" onClick={() => setEditing('new')}>
            Nova atividade
          </button>
        }
      />
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />
      {query.data?.length === 0 && <Empty>Nenhuma atividade cadastrada.</Empty>}
      {query.data && query.data.length > 0 && (
        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Atividade</th>
                <th>Cliente</th>
                <th>Promotor</th>
                <th>Período</th>
                <th>Conclusão</th>
                <th className="r">Concluídas</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((t) => {
                const current = t.active && t.startDate <= t0 && t.endDate >= t0
                return (
                  <tr key={t.id} className="clickable" onClick={() => setEditing(t)}>
                    <td>
                      <strong>{t.title}</strong>
                      {t.description && <div className="small muted">{t.description}</div>}
                    </td>
                    <td>{t.client?.name ?? <span className="muted">Todos os clientes</span>}</td>
                    <td>{t.promotor?.name ?? <span className="muted">Todos os promotores</span>}</td>
                    <td className="num">
                      {fmtDate(t.startDate)} a {fmtDate(t.endDate)}
                    </td>
                    <td>
                      {t.requiresPhoto ? 'Com foto' : 'Marcar como feita'}
                      {t.required && (
                        <div>
                          <span className="chip warn">Obrigatória</span>
                        </div>
                      )}
                    </td>
                    <td className="r">{t.completionCount}</td>
                    <td>{!t.active ? <span className="muted">Desativada</span> : current ? 'Em andamento' : t.endDate < t0 ? <span className="muted">Encerrada</span> : 'Agendada'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <TaskForm task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function TaskForm({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const qc = useQueryClient()
  const lookups = useLookups()
  const [form, setForm] = useState({
    title: task?.title ?? '',
    description: task?.description ?? '',
    client: (task?.client ?? null) as Pick<Client, 'id' | 'name'> | null,
    promotorId: task?.promotorId ?? '',
    startDate: task?.startDate ?? today(),
    endDate: task?.endDate ?? addDays(today(), 7),
    requiresPhoto: task?.requiresPhoto ?? true,
    required: task?.required ?? false,
    active: task?.active ?? true,
  })
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title,
        description: form.description || null,
        clientId: form.client?.id ?? null,
        promotorId: form.promotorId || null,
        startDate: form.startDate,
        endDate: form.endDate,
        requiresPhoto: form.requiresPhoto,
        required: form.required,
        active: form.active,
      }
      return task ? api(`/admin/tasks/${task.id}`, { method: 'PATCH', body }) : api('/admin/tasks', { method: 'POST', body })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      onClose()
    },
  })

  return (
    <Modal
      title={task ? 'Editar atividade' : 'Nova atividade'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={save.isPending || form.title.length < 3} onClick={() => save.mutate()}>
            {task ? 'Salvar atividade' : 'Criar atividade'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Título" className="full">
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Montar ponta de gôndola da campanha" />
        </Field>
        <Field label="Instruções para o promotor" className="full">
          <textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="field full">
          <span>Cliente</span>
          {form.client ? (
            <div className="btn-row">
              <strong>{form.client.name}</strong>
              <button className="btn small" onClick={() => setForm({ ...form, client: null })}>
                Aplicar a todos os clientes
              </button>
            </div>
          ) : (
            <ClientPicker onPick={(c) => setForm({ ...form, client: c })} placeholder="Todos os clientes (ou busque um cliente específico)" />
          )}
        </div>
        <Field label="Promotor" className="full">
          <select className="input" value={form.promotorId} onChange={(e) => setForm({ ...form, promotorId: e.target.value })}>
            <option value="">Todos os promotores</option>
            {lookups.data?.promotores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Início">
          <input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <Field label="Fim">
          <input className="input" type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </Field>
        <label className="check full">
          <input type="checkbox" checked={form.requiresPhoto} onChange={(e) => setForm({ ...form, requiresPhoto: e.target.checked })} />
          Exige foto (a atividade é concluída com a foto; sem foto, o promotor marca como feita e pode deixar uma observação)
        </label>
        <label className="check full">
          <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />
          Obrigatória (o promotor não encerra o atendimento sem concluí-la)
        </label>
        <label className="check full">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Ativa
        </label>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  )
}
