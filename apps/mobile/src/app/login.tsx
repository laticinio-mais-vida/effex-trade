import { Redirect } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Banner, Button, Field, LoadingView, styles } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { homeFor, useAuth } from '@/lib/auth'
import { apiUrl, defaultApiUrl, normalizeUrl, saveApiUrl } from '@/lib/config'
import { colors, space } from '@/lib/theme'

export default function Login() {
  const { status, user, login } = useAuth()
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [server, setServer] = useState(apiUrl())
  const [editingServer, setEditingServer] = useState(false)
  const [serverStatus, setServerStatus] = useState<{ ok: boolean; text: string } | null>(null)

  if (status === 'loading') return <LoadingView />
  if (user) return <Redirect href={homeFor(user.role)} />

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      if (normalizeUrl(server) !== apiUrl()) await saveApiUrl(server)
      await login(loginName, password)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function testServer() {
    const url = normalizeUrl(server)
    setServerStatus(null)
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(`${url}/health`, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error()
      await saveApiUrl(url)
      setServer(url)
      setServerStatus({ ok: true, text: 'Servidor encontrado e salvo.' })
    } catch {
      setServerStatus({ ok: false, text: `Não consegui falar com ${url}. Confira o endereço e se o celular está na mesma rede.` })
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 4, marginBottom: space.md }}>
            <Text style={{ fontSize: 30, fontWeight: '800', color: colors.primary }}>EFFEX Trade</Text>
            <Text style={styles.muted}>Promotoria de vendas</Text>
          </View>

          <Field label="Login" value={loginName} onChangeText={setLoginName} autoCapitalize="none" autoCorrect={false} placeholder="seu.login" returnKeyType="next" />
          <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••" returnKeyType="go" onSubmitEditing={submit} />
          {error ? <Banner tone="danger" text={error} /> : null}
          <Button title="Entrar" onPress={submit} loading={busy} disabled={!loginName.trim() || !password} />

          <View style={{ marginTop: space.lg, gap: space.sm }}>
            <Pressable onPress={() => setEditingServer((v) => !v)}>
              <Text style={styles.muted}>
                Servidor: <Text style={{ color: colors.text }}>{apiUrl()}</Text> <Text style={{ color: colors.primary, fontWeight: '600' }}>{editingServer ? 'fechar' : 'alterar'}</Text>
              </Text>
            </Pressable>
            {editingServer ? (
              <View style={{ gap: space.sm }}>
                <Field value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.0.10:3333" hint={`Padrão: ${defaultApiUrl()}`} />
                <Button title="Testar e salvar" variant="secondary" small onPress={testServer} />
                {serverStatus ? <Banner tone={serverStatus.ok ? 'success' : 'danger'} text={serverStatus.text} /> : null}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
