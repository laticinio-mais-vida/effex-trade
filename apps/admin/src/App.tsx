import { useQuery } from '@tanstack/react-query'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api } from './api'
import { useAuth } from './auth'
import { roleLabel } from './format'
import { AuditErrorsPage } from './pages/AuditErrors'
import { ContestsPage } from './pages/Contests'
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
import { Icon, type IconName } from './icons'
import { Loading } from './ui'

type NavItem = { to: string; label: string; icon: IconName; badge?: 'requests' | 'contests' | 'alerts' }

const groups: { title: string; links: NavItem[] }[] = [
  {
    title: 'Operação',
    links: [
      { to: '/', label: 'Hoje', icon: 'today-outline', badge: 'alerts' },
      { to: '/mapa', label: 'Mapa', icon: 'map-outline' },
      { to: '/liberacoes', label: 'Liberações', icon: 'key-outline', badge: 'requests' },
      { to: '/relatorios', label: 'Relatórios', icon: 'bar-chart-outline' },
      { to: '/fotos', label: 'Avaliar fotos', icon: 'images-outline' },
      { to: '/correcoes', label: 'Auditorias dos vendedores', icon: 'checkmark-done-outline' },
      { to: '/contestacoes', label: 'Contestações', icon: 'chatbubbles-outline', badge: 'contests' },
    ],
  },
  {
    title: 'Cadastros',
    links: [
      { to: '/roteiros', label: 'Roteiros', icon: 'trail-sign-outline' },
      { to: '/clientes', label: 'Clientes', icon: 'storefront-outline' },
      { to: '/produtos', label: 'Produtos e mix', icon: 'cube-outline' },
      { to: '/atividades', label: 'Atividades extras', icon: 'clipboard-outline' },
      { to: '/usuarios', label: 'Usuários', icon: 'people-outline' },
      { to: '/motivos', label: 'Motivos de justificativa', icon: 'document-text-outline' },
    ],
  },
  { title: 'Configuração', links: [{ to: '/regras', label: 'Regras', icon: 'options-outline' }] },
]

function Sidebar() {
  const { user, logout } = useAuth()
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/admin/dashboard'), refetchInterval: 60_000 })
  const counts = { requests: data?.pendingRequests ?? 0, contests: data?.pendingContests ?? 0, alerts: data?.alerts.length ?? 0 }
  const countTitle = { requests: 'Pedidos de liberação aguardando decisão', contests: 'Contestações esperando decisão', alerts: 'Alertas para o supervisor' }
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <NavLink to="/" className="brand" aria-label="EFFEX Trade: ir para Hoje">
          <img src="/marca/effex-trade-assinatura-negativo.svg" alt="EFFEX Trade" />
        </NavLink>
        <div className="client-logo">
          <img src="/marca/cliente-mais-vida.png" alt="Laticínio Mais Vida" />
        </div>
      </div>
      <nav aria-label="Menu principal">
        {groups.map((g) => (
          <div className="nav-group" key={g.title}>
            <div className="nav-group-title">{g.title}</div>
            <div className="nav-group-items">
              {g.links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <Icon name={l.icon} />
                  <span className="nav-label">{l.label}</span>
                  {l.badge && counts[l.badge] > 0 && (
                    <span className="nav-count num" title={countTitle[l.badge]}>
                      {counts[l.badge] > 99 ? '99+' : counts[l.badge]}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <strong>{user?.name}</strong>
        <span>{user ? roleLabel[user.role] : ''}</span>
        <button className="btn danger small" onClick={logout}>
          Sair
        </button>
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
          <Route path="/contestacoes" element={<ContestsPage />} />
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
