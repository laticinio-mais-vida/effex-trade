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
        <img className="login-signature" src="/marca/effex-trade-assinatura.svg" alt="EFFEX Trade" />
        <p className="muted login-lead">Painel da promotoria. Entre com seu login de administrador ou supervisor.</p>
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
        {!busy && (!form.login || !form.password) && <span className="btn-hint">Preencha o login e a senha</span>}
        <div className="login-client">
          <img src="/marca/cliente-mais-vida.png" alt="Laticínio Mais Vida" />
        </div>
      </form>
    </div>
  )
}
