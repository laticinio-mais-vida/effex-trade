import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { prisma } from '../db'
import { env } from '../env'

/**
 * Notificação push (Firebase Cloud Messaging, API HTTP v1) para o celular do supervisor, mesmo com o app fechado.
 * Sem a conta de serviço do Firebase configurada (FCM_SERVICE_ACCOUNT), tudo aqui vira "não faz nada": o resto do
 * sistema segue igual e o supervisor continua vendo os avisos ao abrir o app.
 * O token de acesso do Google é pedido assinando um JWT com a chave da conta de serviço (sem biblioteca externa).
 */

type ServiceAccount = { project_id: string; client_email: string; private_key: string }

let account: ServiceAccount | null | undefined

function loadAccount(): ServiceAccount | null {
  if (account !== undefined) return account
  account = null
  if (!env.fcmServiceAccount) return null
  try {
    const raw = env.fcmServiceAccount.trim().startsWith('{') ? env.fcmServiceAccount : readFileSync(env.fcmServiceAccount, 'utf8')
    const json = JSON.parse(raw)
    if (json.project_id && json.client_email && json.private_key) account = json
    else console.error('push: a conta de serviço do Firebase está incompleta (faltam project_id, client_email ou private_key).')
  } catch (e) {
    console.error('push: não consegui ler a conta de serviço do Firebase (FCM_SERVICE_ACCOUNT)', e instanceof Error ? e.message : e)
  }
  return account ?? null
}

export const pushEnabled = () => loadAccount() !== null

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url')

let cached: { token: string; expiresAt: number } | null = null

async function accessToken(acc: ServiceAccount) {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({ iss: acc.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(acc.private_key)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Google recusou o token (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return cached.token
}

export type PushMessage = {
  title: string
  body: string
  /** Tela do app que abre ao tocar (ex.: "tempos") */
  screen?: string
}

/** Canal Android do aviso (criado pelo app; o Android usa o canal para o som e a importância). */
const CHANNEL = 'supervisor'

async function sendOne(acc: ServiceAccount, token: string, deviceToken: string, msg: PushMessage) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${acc.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: msg.title, body: msg.body },
        data: { screen: msg.screen ?? '' },
        android: { priority: 'HIGH', notification: { channel_id: CHANNEL, sound: 'default' } },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (res.ok) return 'ok' as const
  const text = await res.text()
  // Token que não existe mais (app desinstalado, dados limpos): sai da lista
  if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(text)) return 'gone' as const
  console.error(`push: FCM recusou (${res.status}): ${text.slice(0, 200)}`)
  return 'error' as const
}

/** Envia a notificação a todos os celulares dos usuários. Nunca lança erro: aviso que falha não derruba o fluxo. */
export async function sendPush(userIds: string[], msg: PushMessage) {
  try {
    const acc = loadAccount()
    if (!acc || !userIds.length) return
    const devices = await prisma.pushDevice.findMany({ where: { userId: { in: userIds }, user: { active: true } }, select: { id: true, token: true } })
    if (!devices.length) return
    const token = await accessToken(acc)
    const gone: string[] = []
    await Promise.all(
      devices.map(async (d) => {
        if ((await sendOne(acc, token, d.token, msg)) === 'gone') gone.push(d.id)
      }),
    )
    if (gone.length) await prisma.pushDevice.deleteMany({ where: { id: { in: gone } } })
  } catch (e) {
    console.error('push: falha ao enviar', e instanceof Error ? e.message : e)
  }
}

/** Quem recebe o aviso de um promotor: o supervisor dele; sem supervisor, os administradores. */
export async function recipientsFor(promotorId: string) {
  const promotor = await prisma.user.findUnique({ where: { id: promotorId }, select: { supervisorId: true } })
  if (promotor?.supervisorId) return [promotor.supervisorId]
  return (await prisma.user.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true } })).map((u) => u.id)
}

/** Avisa a equipe do promotor. */
export async function pushToTeamOf(promotorId: string, msg: PushMessage) {
  if (!pushEnabled()) return
  await sendPush(await recipientsFor(promotorId), msg)
}

// ---------- Celulares ----------

export async function registerDevice(userId: string, token: string) {
  await prisma.pushDevice.upsert({
    where: { token },
    create: { userId, token },
    update: { userId, lastSeenAt: new Date() },
  })
}

export async function removeDevice(userId: string, token: string) {
  await prisma.pushDevice.deleteMany({ where: { userId, token } })
}
