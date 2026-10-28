import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { roleLabel } from '../format'
import type { Role, User } from '../types'
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Segmented, useLookups } from '../ui'

type RoleFilter = Role | 'todos'

export function UsersPage() {
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'ADMIN'
  const [role, setRole] = useState<RoleFilter>('todos')
  const [editing, setEditing] = useState<User | 'new' | null>(null)
  const query = useQuery({ queryKey: ['users', role], queryFn: () => api<User[]>('/admin/users', { query: { role: role === 'todos' ? undefined : role } }) })

  return (
    <div>
      <PageHead
        title="Usuários"
        description="Promotores e vendedores ficam ligados a um supervisor, que recebe os pedidos de liberação e confere as auditorias deles."
        actions={
          isAdmin && (
            <button className="btn primary" onClick={() => setEditing('new')}>
              Novo usuário
            </button>
          )
        }
      />
      <div className="toolbar">
        <Segmented<RoleFilter>
          value={role}
          onChange={setRole}
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'PROMOTOR', label: 'Promotores' },
            { value: 'VENDEDOR', label: 'Vendedores' },
            { value: 'SUPERVISOR', label: 'Supervisores' },
            { value: 'ADMIN', label: 'Administradores' },
          ]}
        />
      </div>
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />
      {query.data?.length === 0 && <Empty>Nenhum usuário com este perfil.</Empty>}
      {query.data && query.data.length > 0 && (
        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Login</th>
                <th>Perfil</th>
                <th>Supervisor</th>
                <th>Telefone</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((u) => (
                <tr key={u.id} className={isAdmin ? 'clickable' : ''} onClick={() => isAdmin && setEditing(u)}>
                  <td>
                    <strong>{u.name}</strong>
                  </td>
                  <td className="num">{u.login}</td>
                  <td>{roleLabel[u.role]}</td>
                  <td>{u.supervisor?.name ?? <span className="muted">—</span>}</td>
                  <td className="num">{u.phone ?? '—'}</td>
                  <td>{u.active ? 'Ativo' : <span className="muted">Inativo</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function UserForm({ user, onClose }: { user: User | null; onClose: () => void }) {
  const qc = useQueryClient()
  const lookups = useLookups()
  const [form, setForm] = useState({
    name: user?.name ?? '',
    login: user?.login ?? '',
    role: (user?.role ?? 'PROMOTOR') as Role,
    supervisorId: user?.supervisorId ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    password: '',
    active: user?.active ?? true,
  })
  const needsSupervisor = form.role === 'PROMOTOR' || form.role === 'VENDEDOR'

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        login: form.login,
        role: form.role,
        supervisorId: needsSupervisor ? form.supervisorId || null : null,
        email: form.email || null,
        phone: form.phone || null,
        ...(form.password ? { password: form.password } : {}),
        ...(user ? { active: form.active } : {}),
      }
      return user ? api(`/admin/users/${user.id}`, { method: 'PATCH', body }) : api('/admin/users', { method: 'POST', body })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['lookups'] })
      onClose()
    },
  })

  return (
    <Modal
      title={user ? user.name : 'Novo usuário'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={save.isPending || !form.name || !form.login || (!user && form.password.length < 6)} onClick={() => save.mutate()}>
            {user ? 'Salvar usuário' : 'Criar usuário'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Nome" className="full">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Login">
          <input className="input" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value.toLowerCase() })} placeholder="ex.: joao.santos" />
        </Field>
        <Field label={user ? 'Nova senha (deixe vazio para manter)' : 'Senha (mínimo 6 caracteres)'}>
          <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Perfil">
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {Object.entries(roleLabel).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Supervisor">
          <select className="input" value={form.supervisorId} disabled={!needsSupervisor} onChange={(e) => setForm({ ...form, supervisorId: e.target.value })}>
            <option value="">{needsSupervisor ? 'Sem supervisor' : 'Não se aplica'}</option>
            {lookups.data?.supervisores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="E-mail">
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Telefone">
          <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        {user && (
          <label className="check full">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Usuário ativo (inativos não conseguem entrar)
          </label>
        )}
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  )
}
