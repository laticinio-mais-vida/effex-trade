import { useQuery } from '@tanstack/react-query'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api } from './api'
import { useAuth } from './auth'
import { roleLabel } from './format'
import { AuditErrorsPage } from './pages/AuditErrors'
import { ClientsPage } from './pages/Clients'
import { DashboardPage } from './pages/Dashboard'
import { LoginPage } from './pages/Login'
import { MapPage } from './pages/Map'
import { PhotosPage } from './pages/Photos'
import { ProductsPage } from './pages/Products'
import { ReasonsPage } from './pages/Reasons'
import { ReportsPage } from './pages/Reports'
import { RequestsPage } from './pages/Requests'
import { RoutesPage } from './pages/Routes'
import { SettingsPage } from './pages/Settings'
import { TasksPage } from './pages/Tasks'
import { UsersPage } from './pages/Users'
import type { Dashboard } from './types'
import { Loading } from './ui'

function TagMark() {
  return (
    <svg className="brand-tag" viewBox="0 0 30 22" aria-hidden="true">
      <path d="M2 2h19l7 9-7 9H2z" fill="#F5C518" stroke="#F5C518" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="20" cy="11" r="2.3" fill="#14213D" />
    </svg>
  )
}

const groups = [
  {
    title: 'Operação',
    links: [
      { to: '/', label: 'Hoje', badge: 'alerts' as const },
      { to: '/mapa', label: 'Mapa' },
      { to: '/liberacoes', label: 'Liberações', badge: 'requests' as const },
      { to: '/relatorios', label: 'Relatórios' },
      { to: '/fotos', label: 'Avaliar fotos' },
      { to: '/correcoes', label: 'Correções de auditoria' },
    ],
  },
  {
    title: 'Cadastros',
    links: [
      { to: '/roteiros', label: 'Roteiros' },
      { to: '/clientes', label: 'Clientes' },
      { to: '/produtos', label: 'Produtos e mix' },
      { to: '/atividades', label: 'Atividades extras' },
      { to: '/usuarios', label: 'Usuários' },
      { to: '/motivos', label: 'Motivos de justificativa' },
    ],
  },
  { title: 'Configuração', links: [{ to: '/regras', label: 'Regras' }] },
]

function Sidebar() {
  const { user, logout } = useAuth()
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/admin/dashboard'), refetchInterval: 60_000 })
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand">
        <TagMark />
        EFFEX Trade
      </NavLink>
      <nav aria-label="Menu principal">
        {groups.map((g) => (
          <div className="nav-group" key={g.title}>
            <div className="nav-group-title">{g.title}</div>
            {g.links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                {l.label}
                {'badge' in l && l.badge === 'requests' && !!data?.pendingRequests && <span className="nav-count">{data.pendingRequests}</span>}
                {'badge' in l && l.badge === 'alerts' && !!data?.alerts.length && (
                  <span className="nav-count" title="Alertas para o supervisor">
                    {data.alerts.length}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <strong>{user?.name}</strong>
        <span>{user ? roleLabel[user.role] : ''}</span>
        <div style={{ marginTop: 8 }}>
          <button className="linklike" onClick={logout}>
            Sair
          </button>
        </div>
      </div>
    </aside>
  )
}

export function App() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading text="Abrindo o painel…" />
  if (!user) return <LoginPage />
  const flush = location.pathname === '/mapa'
  return (
    <div className="shell">
      <Sidebar />
      <main className={`main ${flush ? 'flush' : ''}`}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/mapa" element={<MapPage />} />
          <Route path="/liberacoes" element={<RequestsPage />} />
          <Route path="/relatorios" element={<ReportsPage />} />
          <Route path="/fotos" element={<PhotosPage />} />
          <Route path="/correcoes" element={<AuditErrorsPage />} />
          <Route path="/roteiros" element={<RoutesPage />} />
          <Route path="/clientes" element={<ClientsPage />} />
          <Route path="/produtos" element={<ProductsPage />} />
          <Route path="/atividades" element={<TasksPage />} />
          <Route path="/usuarios" element={<UsersPage />} />
          <Route path="/motivos" element={<ReasonsPage />} />
          <Route path="/regras" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
