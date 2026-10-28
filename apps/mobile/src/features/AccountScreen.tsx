import { useState } from 'react'
import { Alert, Text } from 'react-native'
import { Banner, Button, Card, Field, Muted, Screen, SectionTitle, styles } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { roleLabels, useAuth } from '@/lib/auth'
import { apiUrl } from '@/lib/config'

export function AccountScreen({ extra }: { extra?: React.ReactNode }) {
  const { user, logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  if (!user) return null

  async function changePassword() {
    setBusy(true)
    setMsg(null)
    try {
      await api('/auth/password', { body: { current, next } })
      setCurrent('')
      setNext('')
      setMsg({ ok: true, text: 'Senha alterada.' })
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Card>
        <Text style={styles.title}>{user.name}</Text>
        <Muted>
          {roleLabels[user.role]} · login {user.login}
        </Muted>
        {user.supervisor ? <Muted>Supervisor: {user.supervisor.name}</Muted> : null}
        <Muted>Servidor: {apiUrl()}</Muted>
      </Card>
      {extra}
      <SectionTitle>Trocar senha</SectionTitle>
      <Card>
        <Field label="Senha atual" value={current} onChangeText={setCurrent} secureTextEntry />
        <Field label="Nova senha" value={next} onChangeText={setNext} secureTextEntry hint="Mínimo de 6 caracteres" />
        {msg ? <Banner tone={msg.ok ? 'success' : 'danger'} text={msg.text} /> : null}
        <Button title="Salvar nova senha" variant="secondary" onPress={changePassword} loading={busy} disabled={!current || next.length < 6} />
      </Card>
      <Button
        title="Sair"
        variant="danger"
        onPress={() =>
          Alert.alert('Sair do app?', user.role === 'PROMOTOR' ? 'O envio da sua localização será interrompido.' : undefined, [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Sair', style: 'destructive', onPress: () => void logout() },
          ])
        }
      />
    </Screen>
  )
}
