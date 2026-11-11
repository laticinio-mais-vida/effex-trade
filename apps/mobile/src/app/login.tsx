import { Image } from 'expo-image'
import { Redirect } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Banner, Button, Field, LoadingView, styles, TextAction } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { homeFor, useAuth } from '@/lib/auth'
import { apiUrl, defaultApiUrl, normalizeUrl, saveApiUrl } from '@/lib/config'
import { colors, sizes, space } from '@/lib/theme'

/** Assinatura do kit de marca (fundo claro). */
const SIGNATURE = require('../../assets/marca/effex-trade-assinatura.png')
/** Proporção do arquivo da assinatura (1600 x 224). */
const SIGNATURE_RATIO = 1600 / 224

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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.fundo }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space.sm, marginBottom: space.md }}>
            <Image
              source={SIGNATURE}
              accessibilityLabel="EFFEX Trade"
              style={{ width: '100%', maxWidth: sizes.assinatura, aspectRatio: SIGNATURE_RATIO }}
              contentFit="contain"
            />
            <Text style={styles.muted}>Promotoria de vendas</Text>
          </View>

          <Field label="Login" value={loginName} onChangeText={setLoginName} autoCapitalize="none" autoCorrect={false} placeholder="seu.login" returnKeyType="next" />
          <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••" returnKeyType="go" onSubmitEditing={submit} />
          {error ? <Banner tone="danger" text={error} /> : null}
          <Button title="Entrar" onPress={submit} loading={busy} disabled={!loginName.trim() || !password} missing="Preencha o login e a senha" />

          <View style={{ marginTop: space.lg, gap: space.xs }}>
            <Text style={styles.muted}>
              Servidor: <Text style={{ color: colors.texto }}>{apiUrl()}</Text>
            </Text>
            <TextAction title={editingServer ? 'Fechar' : 'Alterar servidor'} onPress={() => setEditingServer((v) => !v)} style={{ alignSelf: 'flex-start' }} />
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
