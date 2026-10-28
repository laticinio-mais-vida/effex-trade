import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { ErrorBox, Field } from '../ui'

export function LoginPage() {
  const { login } = useAuth()
  const [form, setForm] = useState({ login: '', password: '' })
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(form.login, form.password)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <svg className="brand-tag" viewBox="0 0 30 22" aria-hidden="true">
            <path d="M2 2h19l7 9-7 9H2z" fill="#F5C518" stroke="#14213D" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="20" cy="11" r="2.3" fill="#14213D" />
          </svg>
          EFFEX Trade
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Painel de gestão da promotoria. Entre com seu login de administrador ou supervisor.
        </p>
        <Field label="Login">
          <input className="input" autoFocus autoComplete="username" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
        </Field>
        <Field label="Senha">
          <input className="input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn primary" disabled={busy || !form.login || !form.password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
