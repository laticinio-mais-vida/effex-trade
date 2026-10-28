import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { areaLabel, roleLabel, UFS } from '../format'
import type { Area, ClientCity, Role, User } from '../types'
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Segmented, useLookups } from '../ui'

type RoleFilter = Role | 'todos'

const ROLES: Role[] = ['PROMOTOR', 'VENDEDOR', 'SUPERVISOR', 'ADMIN']
const newLabel: Record<Role, string> = { PROMOTOR: 'Novo promotor', VENDEDOR: 'Novo vendedor', SUPERVISOR: 'Novo supervisor', ADMIN: 'Novo administrador' }
const roleHelp: Record<Role, string> = {
  PROMOTOR: 'Faz o roteiro no app. Só pode ter no roteiro clientes das cidades dele.',
  VENDEDOR: 'Audita no app as fotos dos clientes das cidades dele.',
  SUPERVISOR: 'Libera os pedidos dos promotores da equipe, audita fotos e confere as auditorias dos vendedores. Vê os clientes das cidades dele.',
  ADMIN: 'Acesso completo ao painel: cadastros, regras e usuários. Vê todos os clientes.',
}

export function UsersPage() {
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'ADMIN'
  const [role, setRole] = useState<RoleFilter>('todos')
  const [editing, setEditing] = useState<User | Role | null>(null)
  const query = useQuery({ queryKey: ['users', role], queryFn: () => api<User[]>('/admin/users', { query: { role: role === 'todos' ? undefined : role } }) })

  return (
    <div>
      <PageHead
        title="Usuários"
        description="Promotores, vendedores e supervisores só veem os clientes das cidades do seu cadastro. Promotores e vendedores ficam ligados a um supervisor, que recebe os pedidos de liberação e confere as auditorias deles."
        actions={
          isAdmin && (
            <button className="btn primary" onClick={() => setEditing(role === 'todos' ? 'PROMOTOR' : role)}>
              {role === 'todos' ? 'Novo usuário' : newLabel[role]}
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
                <th>Cidades</th>
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
                  <td>
                    {u.role === 'ADMIN' ? (
                      <span className="muted">Todas</span>
                    ) : u.areas.length ? (
                      u.areas.map(areaLabel).join(', ')
                    ) : (
                      <span style={{ color: 'var(--notdone)' }}>Nenhuma: não vê clientes</span>
                    )}
                  </td>
                  <td>{u.supervisor?.name ?? <span className="muted">—</span>}</td>
                  <td className="num">{u.phone ?? '—'}</td>
                  <td>{u.active ? 'Ativo' : <span className="muted">Inativo</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <UserForm user={typeof editing === 'string' ? null : editing} initialRole={typeof editing === 'string' ? editing : editing.role} onClose={() => setEditing(null)} />}
    </div>
  )
}

function UserForm({ user, initialRole, onClose }: { user: User | null; initialRole: Role; onClose: () => void }) {
  const qc = useQueryClient()
  const lookups = useLookups()
  const [form, setForm] = useState({
    name: user?.name ?? '',
    login: user?.login ?? '',
    role: initialRole,
    supervisorId: user?.supervisorId ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    password: '',
    active: user?.active ?? true,
  })
  const [areas, setAreas] = useState<Area[]>(user?.areas ?? [])
  const needsSupervisor = form.role === 'PROMOTOR' || form.role === 'VENDEDOR'
  const needsAreas = form.role !== 'ADMIN'

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        login: form.login,
        role: form.role,
        supervisorId: needsSupervisor ? form.supervisorId || null : null,
        email: form.email || null,
        phone: form.phone || null,
        areas: needsAreas ? areas : [],
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

  const missingAreas = needsAreas && areas.length === 0
  return (
    <Modal
      title={user ? user.name : newLabel[form.role]}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={save.isPending || !form.name || !form.login || (!user && form.password.length < 6) || missingAreas}
            title={missingAreas ? 'Inclua ao menos uma cidade atendida.' : undefined}
            onClick={() => save.mutate()}
          >
            {user ? 'Salvar usuário' : `Criar ${roleLabel[form.role].toLowerCase()}`}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full" style={{ minWidth: 0 }}>
          <span>Perfil</span>
          {/* Rola de lado em tela estreita, em vez de alargar a janela */}
          <div style={{ overflowX: 'auto', minWidth: 0 }}>
            <Segmented<Role> value={form.role} onChange={(role) => setForm({ ...form, role })} options={ROLES.map((r) => ({ value: r, label: roleLabel[r] }))} />
          </div>
          <span className="small muted" style={{ fontWeight: 400, whiteSpace: 'normal' }}>
            {roleHelp[form.role]}
          </span>
        </div>
        <Field label="Nome" className="full">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Login">
          <input className="input" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value.toLowerCase() })} placeholder="ex.: joao.santos" />
        </Field>
        <Field label={user ? 'Nova senha (deixe vazio para manter)' : 'Senha (mínimo 6 caracteres)'}>
          <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
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
        <Field label="Telefone">
          <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="E-mail" className="full">
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        {needsAreas && <AreasField areas={areas} onChange={setAreas} />}
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

/** Cidades atendidas: UF + cidade (sugere as cidades que já têm clientes) ou a UF inteira. */
function AreasField({ areas, onChange }: { areas: Area[]; onChange: (areas: Area[]) => void }) {
  const cities = useQuery({ queryKey: ['client-cities'], queryFn: () => api<ClientCity[]>('/admin/client-cities') })
  const [state, setState] = useState(() => areas[areas.length - 1]?.state ?? cities.data?.[0]?.state ?? 'BA')
  const [city, setCity] = useState('')
  const options = cities.data?.filter((c) => c.state === state) ?? []
  const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
  const typed = city.replace(/\s+/g, ' ').trim()
  const known = options.find((c) => key(c.city) === key(typed))
  const wholeUf = areas.some((a) => a.state === state && !a.city)
  const duplicate = areas.some((a) => a.state === state && (typed ? !!a.city && key(a.city) === key(typed) : !a.city))

  const add = () => {
    const area = { state, city: typed ? (known?.city ?? typed) : null }
    // A UF inteira substitui as cidades dela já incluídas
    onChange([...areas.filter((a) => !(area.city === null && a.state === state)), area])
    setCity('')
  }
  const countOf = (a: Area) =>
    a.city ? (cities.data?.find((c) => c.state === a.state && key(c.city) === key(a.city!))?.clients ?? 0) : (cities.data ?? []).filter((c) => c.state === a.state).reduce((s, c) => s + c.clients, 0)

  return (
    <div className="field full" style={{ minWidth: 0 }}>
      <span>Cidades atendidas</span>
      <span className="small muted" style={{ fontWeight: 400, whiteSpace: 'normal' }}>
        Só os clientes destas cidades aparecem para o usuário. Deixe a cidade vazia para incluir a UF inteira.
      </span>
      <div className="btn-row" style={{ alignItems: 'stretch', flexWrap: 'nowrap' }}>
        <select className="input" style={{ width: 84, flex: 'none' }} aria-label="UF" value={state} onChange={(e) => setState(e.target.value)}>
          {UFS.map((uf) => (
            <option key={uf} value={uf}>
              {uf}
            </option>
          ))}
        </select>
        <input
          className="input"
          style={{ flex: 1, minWidth: 0 }}
          aria-label="Cidade"
          list="area-cities"
          value={city}
          placeholder={wholeUf ? `A UF ${state} inteira já está incluída` : `Cidade (vazio = ${state} inteira)`}
          onChange={(e) => setCity(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !duplicate && !wholeUf) {
              e.preventDefault()
              add()
            }
          }}
        />
        <datalist id="area-cities">
          {options.map((c) => (
            <option key={c.city} value={c.city}>
              {c.clients} clientes
            </option>
          ))}
        </datalist>
        <button type="button" className="btn" disabled={duplicate || wholeUf} onClick={add}>
          Incluir
        </button>
      </div>
      {typed && !known && cities.data && <span className="small" style={{ color: 'var(--justified)', fontWeight: 400 }}>Ainda não há clientes cadastrados em {typed} - {state}.</span>}
      {areas.length === 0 ? (
        <span className="small" style={{ color: 'var(--notdone)', fontWeight: 400 }}>
          Nenhuma cidade: inclua ao menos uma para o usuário ver clientes.
        </span>
      ) : (
        <ul className="client-chips" style={{ marginTop: 4 }}>
          {areas.map((a) => (
            <li key={`${a.state}|${a.city ?? ''}`} className="client-chip">
              <span>
                {areaLabel(a)} <span className="muted">· {countOf(a)} clientes</span>
              </span>
              <button type="button" aria-label={`Tirar ${areaLabel(a)}`} onClick={() => onChange(areas.filter((x) => x !== a))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
