/**
 * Teste de ponta a ponta contra a API rodando (npm run dev) com o seed carregado.
 * Uso: npm run smoke   (API_URL=http://localhost:3333 por padrão)
 * Atenção: altera dados (faz check-in, fotos, liberações). Rode `npm run db:seed` depois para restaurar.
 */
import { shelfPng } from '../prisma/seed-image'
import { checkLunchAlerts } from '../src/services/alerts'
import { prisma } from '../src/db'

const API = process.env.API_URL ?? 'http://localhost:3333'
let failures = 0

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const isForm = body instanceof FormData
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  })
  const type = res.headers.get('content-type') ?? ''
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer()
  return { status: res.status, data: data as any }
}

function check(name: string, ok: boolean, info?: unknown) {
  if (ok) console.log(`  ok  ${name}`)
  else {
    failures++
    console.log(`  FALHOU  ${name}`, info ?? '')
  }
}

async function login(login: string) {
  const r = await call(null, 'POST', '/auth/login', { login, password: '123456' })
  if (r.status !== 200) throw new Error(`login ${login} falhou: ${JSON.stringify(r.data)}`)
  return r.data.token as string
}

type Loc = { latitude: number; longitude: number; accuracy?: number }
const near = (c: { latitude: number; longitude: number }): Loc => ({ latitude: c.latitude + 0.0003, longitude: c.longitude, accuracy: 12 })

function photoForm(fields: Record<string, string>, kind = 'ANTES') {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  form.append('file', new Blob([new Uint8Array(shelfPng(7, kind as any))], { type: 'image/png' }), 'foto.png')
  return form
}

/** Check-in com a foto da fachada (multipart). */
function checkinForm(loc: Loc, extra: Record<string, string> = {}) {
  return photoForm({ latitude: String(loc.latitude), longitude: String(loc.longitude), accuracy: String(loc.accuracy ?? 10), ...extra }, 'FACHADA')
}

console.log('Autenticação')
check('senha errada recusada', (await call(null, 'POST', '/auth/login', { login: 'admin', password: 'x' })).status === 401)
const promotor = await login('promotor3')
const supervisor = await login('supervisor')
const vendedor = await login('vendedor1')
const admin = await login('admin')
const promotorId = (await call(promotor, 'GET', '/auth/me')).data.id
check('promotor não acessa painel', (await call(promotor, 'GET', '/admin/dashboard')).status === 403)

console.log('Roteiro do dia')
const day = await call(promotor, 'GET', '/promotor/day')
check('roteiro carregado', day.status === 200 && day.data.visits.length > 0, day.data)
check('roteiro ainda não começou (sem botão de iniciar)', day.data.workDay.startedAt === null, day.data.workDay)
check('não existe "iniciar roteiro"', (await call(promotor, 'POST', '/promotor/day/start', near(day.data.visits[0].client))).status === 404)
const visits = day.data.visits as any[]
const first = visits[0]
const second = visits[1]
const far: Loc = { latitude: first.client.latitude + 0.01, longitude: first.client.longitude }
const today = day.data.date as string
let r0 = await call(promotor, 'POST', '/promotor/lunch/start', {})
check('almoço só depois do primeiro atendimento', r0.status === 409 && r0.data.code === 'ROTEIRO_NAO_INICIADO', r0.data)

console.log('Abertura do atendimento (cerca, ordem, fachada)')
let r = await call(promotor, 'POST', `/promotor/visits/${second.id}/checkin`, checkinForm(near(second.client)))
check('fora da ordem bloqueado', r.status === 409 && r.data.code === 'FORA_DA_ORDEM', r.data)
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/checkin`, checkinForm(far))
check('fora da cerca bloqueado', r.status === 422 && r.data.code === 'FORA_DA_CERCA', r.data)
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/checkin`, checkinForm(near(first.client), { mocked: 'true' }))
check('GPS falso bloqueado', r.status === 422 && r.data.code === 'GPS_SIMULADO', r.data)
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/checkin`, near(first.client))
check('sem foto da fachada bloqueado', r.status === 422 && r.data.code === 'FOTO_FACHADA', r.data)

console.log('Liberação de cerca pelo supervisor')
r = await call(promotor, 'POST', '/promotor/requests', { type: 'CHECKIN_FORA_CERCA', visitId: first.id, reason: 'GPS impreciso na porta da loja', ...far })
check('pedido criado', r.status === 200 && r.data.status === 'PENDENTE', r.data)
const requestId = r.data.id
r = await call(promotor, 'POST', '/promotor/requests', { type: 'CHECKIN_FORA_CERCA', visitId: first.id, reason: 'de novo' })
check('pedido duplicado recusado', r.status === 409, r.data)
r = await call(supervisor, 'POST', `/supervisor/requests/${requestId}/decide`, { approve: true, note: 'ok' })
check('supervisor aprovou', r.status === 200 && r.data.status === 'APROVADA', r.data)
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/checkin`, checkinForm(far))
check('check-in liberado fora da cerca, com fachada', r.status === 200 && r.data.status === 'EM_ATENDIMENTO' && r.data.photos.some((p: any) => p.type === 'FACHADA'), r.data)
check('próximo passo é a foto de antes', r.data.progress?.next === 'ANTES', r.data.progress)
const started = (await call(promotor, 'GET', '/promotor/day')).data.workDay
check('roteiro começou no primeiro check-in', !!started.startedAt, started)

console.log('Sequência: antes -> depois com produtos -> ruptura -> check-out')
const loc1 = near(first.client)
const upload = (visitId: string, type: string, extra: Record<string, string> = {}) =>
  call(promotor, 'POST', `/promotor/visits/${visitId}/photos`, photoForm({ type, latitude: String(loc1.latitude), longitude: String(loc1.longitude), ...extra }, type))

const products = (await call(promotor, 'GET', `/promotor/products?visitId=${first.id}`)).data as any[]
const mix = products.filter((p) => p.inMix)
const mixAdmin = (await call(admin, 'GET', `/admin/clients/${first.client.id}/mix`)).data as any[]
check('só aparecem os produtos que o cliente compra', mix.length > 0 && products.length === mix.length && products.length === mixAdmin.length, { products: products.length, mix: mixAdmin.length })
const catalog = (await call(admin, 'GET', '/admin/products?pageSize=200')).data.items as any[]
const outside = catalog.find((p) => !mixAdmin.some((m) => m.id === p.id))

r = await upload(first.id, 'DEPOIS', { productIds: JSON.stringify([mix[0].id]) })
check('depois antes do antes bloqueado', r.status === 422 && r.data.code === 'SEQUENCIA', r.data)
r = await upload(first.id, 'ANTES')
check('foto de antes', r.status === 200, r.data)
r = await upload(first.id, 'DEPOIS')
check('depois sem produtos bloqueado', r.status === 422 && r.data.code === 'PRODUTOS_NAO_IDENTIFICADOS', r.data)
r = await upload(first.id, 'DEPOIS', { productIds: JSON.stringify([outside.id]) })
check('produto que o cliente não compra recusado', r.status === 400 && r.data.code === 'PRODUTO_FORA_DO_MIX', r.data)
const shown = mix.slice(0, Math.max(1, mix.length - 2))
r = await upload(first.id, 'DEPOIS', { productIds: JSON.stringify(shown.map((p) => p.id)) })
check('depois com produtos identificados', r.status === 200 && r.data.products.length === shown.length, r.data)
r = await upload(first.id, 'ANTES')
check('antes depois do depois bloqueado', r.status === 422 && r.data.code === 'SEQUENCIA', r.data)
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/checkout`, loc1)
check('check-out sem confirmar ruptura bloqueado', r.status === 422 && r.data.code === 'SEQUENCIA_INCOMPLETA' && r.data.details.missing.includes('RUPTURA'), r.data)
const rupture = (await call(promotor, 'GET', `/promotor/visits/${first.id}/rupture`)).data
const expectedMissing = mix.filter((p) => !shown.some((s) => s.id === p.id)).map((p) => p.id).sort()
check('contraste mix x fotos de depois', JSON.stringify(rupture.missing.map((p: any) => p.id).sort()) === JSON.stringify(expectedMissing), { rupture, expectedMissing })
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/rupture/confirm`, { productIds: [] })
check('confirmação com lista diferente recusada', expectedMissing.length === 0 || (r.status === 409 && r.data.code === 'LISTA_MUDOU'), r.data)
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/rupture/confirm`, { productIds: expectedMissing })
check('ruptura confirmada', r.status === 200 && r.data.progress.ruptureConfirmed && r.data.ruptures.length === expectedMissing.length, r.data)
r = await upload(first.id, 'VENCIMENTO', { meta: JSON.stringify({ produto: 'Iogurte Morango 170g', validade: '2026-11-02', quantidade: 3 }) })
check('foto de vencimento a qualquer momento', r.status === 200, r.data)
console.log('Atividades extras (com e sem foto, obrigatórias)')
const taskNoPhoto = (
  await call(admin, 'POST', '/admin/tasks', { title: 'Perguntar sobre ilha de refrigerados', clientId: first.client.id, startDate: today, endDate: today, requiresPhoto: false, required: true })
).data
const taskPhoto = (
  await call(admin, 'POST', '/admin/tasks', { title: 'Fotografar ponta de gôndola', clientId: first.client.id, startDate: today, endDate: today, requiresPhoto: true, required: true })
).data
check('atividades criadas com "exige foto" e "obrigatória"', taskNoPhoto.required === true && taskNoPhoto.requiresPhoto === false && taskPhoto.requiresPhoto === true, { taskNoPhoto, taskPhoto })
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/checkout`, loc1)
check(
  'check-out com atividade obrigatória pendente recusado',
  r.status === 422 && r.data.code === 'ATIVIDADE_PENDENTE' && r.data.details.tasks.length === 2,
  r.data,
)
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/tasks/${taskPhoto.id}/complete`, {})
check('atividade de foto não conclui sem foto', r.status === 422 && r.data.code === 'FOTO_OBRIGATORIA', r.data)
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/tasks/${taskNoPhoto.id}/complete`, { notes: 'Gerente libera a ilha dia 10' })
check('atividade sem foto concluída com observação', r.status === 200 && r.data.tasks.find((t: any) => t.id === taskNoPhoto.id)?.done === true, r.data.tasks)
r = await upload(first.id, 'ATIVIDADE_EXTRA', { taskId: taskPhoto.id })
check('foto da atividade enviada', r.status === 200, r.data)
r = await call(promotor, 'GET', `/promotor/visits/${first.id}`)
check('foto concluiu a atividade', r.data.tasks.find((t: any) => t.id === taskPhoto.id)?.done === true, r.data.tasks)
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/checkout`, loc1)
check('check-out concluído', r.status === 200 && r.data.status === 'CONCLUIDA', r.data)

console.log('Almoço')
r = await call(promotor, 'POST', '/promotor/lunch/start', loc1)
check('almoço aberto', r.status === 200 && !!r.data.lunchStartedAt && !r.data.lunchEndedAt, r.data)
r = await call(promotor, 'POST', '/promotor/lunch/start', loc1)
check('só um almoço por dia', r.status === 409 && r.data.code === 'ALMOCO_JA_FEITO', r.data)

console.log('Encerramento automático e reabertura do cliente')
const afterFirst = (await call(promotor, 'GET', '/promotor/day')).data
const nextVisit = afterFirst.visits.find((v: any) => v.id === afterFirst.nextVisitId)
r = await call(promotor, 'POST', `/promotor/visits/${nextVisit.id}/checkin`, checkinForm(near(nextVisit.client)))
check('abertura do próximo cliente encerrou o almoço', r.status === 200 && !!r.data.lunchEndedAt, r.data)
const lastPhotoAt = new Date(Date.now() - 1000).toISOString()
r = await call(
  promotor,
  'POST',
  `/promotor/visits/${nextVisit.id}/photos`,
  photoForm({ type: 'ANTES', takenAt: lastPhotoAt, latitude: String(nextVisit.client.latitude), longitude: String(nextVisit.client.longitude) }),
)
check('tirou a foto de antes e "esqueceu" o check-out', r.status === 200, r.data)
const stamped = await fetch(`${API}${r.data.url}`).then((res) => res.arrayBuffer())
check('foto gravada com a faixa de data e hora (imagem alterada no servidor)', stamped.byteLength > 0 && stamped.byteLength !== shelfPng(7, 'ANTES').length, stamped.byteLength)
r = await call(promotor, 'POST', '/promotor/visits', { clientId: first.client.id })
check('cliente já atendido não entra de novo como extra', r.status === 409 && r.data.code === 'CLIENTE_NO_ROTEIRO' && r.data.details.status === 'CONCLUIDA', r.data)
r = await call(promotor, 'POST', `/promotor/visits/${nextVisit.id}/reopen`, checkinForm(near(nextVisit.client)))
check('só reabre atendimento concluído', r.status === 409 && r.data.code === 'STATUS_INVALIDO', r.data)
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/reopen`, near(first.client))
check('reabrir exige a foto da fachada', r.status === 422 && r.data.code === 'FOTO_FACHADA', r.data)
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/reopen`, checkinForm(near(first.client)))
check('reabrir o cliente encerrou o atendimento esquecido', r.status === 200 && r.data.reopened && r.data.autoClosedVisits?.[0]?.visitId === nextVisit.id, r.data)
check(
  'reaberto continua de onde parou (passos e atividades feitos, 2 aberturas)',
  r.data.status === 'EM_ATENDIMENTO' && r.data.progress.ruptureConfirmed && r.data.progress.missing.length === 0 && r.data.tasks.filter((t: any) => t.required).every((t: any) => t.done) && r.data.sessions.length === 2,
  { progress: r.data.progress, tasks: r.data.tasks, sessions: r.data.sessions },
)
const closed = (await call(promotor, 'GET', `/promotor/visits/${nextVisit.id}`)).data
check(
  'saída do esquecido = última foto',
  closed.status === 'CONCLUIDA' && closed.autoClosed && Math.abs(new Date(closed.checkoutAt).getTime() - new Date(lastPhotoAt).getTime()) < 2000,
  { status: closed.status, autoClosed: closed.autoClosed, checkoutAt: closed.checkoutAt, lastPhotoAt },
)
r = await call(promotor, 'POST', `/promotor/visits/${first.id}/checkout`, loc1)
check('check-out do cliente reaberto', r.status === 200 && r.data.status === 'CONCLUIDA' && r.data.sessions.every((x: any) => x.checkoutAt), r.data)

console.log('Cliente extra fora do roteiro, liberação sem fotos e encerramento do roteiro')
const dayNow = (await call(promotor, 'GET', '/promotor/day')).data
const newClient = (await call(promotor, 'GET', '/promotor/clients')).data.find((c: any) => !dayNow.visits.some((v: any) => v.client.id === c.id))
r = await call(promotor, 'POST', '/promotor/visits', { clientId: newClient.id })
check('cliente fora do roteiro incluído como extra', r.status === 200 && r.data.origin === 'EXTRA', r.data)
const extra = r.data
r = await call(promotor, 'POST', `/promotor/visits/${extra.id}/checkin`, checkinForm(near(extra.client)))
check('abriu o extra', r.status === 200, r.data)
r = await call(supervisor, 'POST', '/supervisor/permissions', { promotorId, type: 'DISPENSA_FOTOS', visitId: extra.id, note: 'Gôndola em reforma' })
check('supervisor liberou sem fotos', r.status === 200 && r.data.status === 'APROVADA', r.data)
r = await call(promotor, 'POST', `/promotor/visits/${extra.id}/checkout`, {})
check('check-out sem GPS recusado (cerca no check-out)', r.status === 422 && r.data.code === 'LOCALIZACAO_OBRIGATORIA', r.data)
r = await call(promotor, 'POST', `/promotor/visits/${extra.id}/checkout`, { latitude: extra.client.latitude + 0.02, longitude: extra.client.longitude })
check('check-out fora da cerca recusado', r.status === 422 && r.data.code === 'FORA_DA_CERCA', r.data)
r = await call(promotor, 'POST', `/promotor/visits/${extra.id}/checkout`, near(extra.client))
check('check-out do extra liberado sem fotos', r.status === 200 && r.data.status === 'CONCLUIDA', r.data)

r = await call(promotor, 'POST', '/promotor/day/end', {})
check('encerrar com pendências recusado', r.status === 422 && r.data.code === 'ROTEIRO_INCOMPLETO' && r.data.details.pending.length > 0, r.data)
const pendingList = r.data.details.pending as { visitId: string }[]
const reasonId = day.data.reasons[0].id
r = await call(promotor, 'POST', '/promotor/day/end', { justifications: pendingList.map((p) => ({ visitId: p.visitId, reasonId, text: 'curto' })) })
check('justificativa curta recusada no encerramento', r.status === 422 && r.data.code === 'JUSTIFICATIVA_CURTA', r.data)
r = await call(promotor, 'POST', '/promotor/day/end', {
  justifications: pendingList.map((p) => ({ visitId: p.visitId, reasonId, text: 'Chuva forte alagou a rua, sem acesso à loja.' })),
})
check('roteiro encerrado com as pendências justificadas', r.status === 200 && !!r.data.closedAt, r.data)
const extraDone = (await call(promotor, 'GET', `/promotor/visits/${extra.id}`)).data
check(
  'ponto de fim = última atividade (check-out do extra), não o encerramento',
  Math.abs(new Date(r.data.endedAt).getTime() - new Date(extraDone.checkoutAt).getTime()) < 1000 && new Date(r.data.endedAt) <= new Date(r.data.closedAt),
  { endedAt: r.data.endedAt, lastCheckout: extraDone.checkoutAt, closedAt: r.data.closedAt },
)
r = await call(promotor, 'POST', '/promotor/visits', { clientId: first.client.id })
check('depois de encerrado não aceita novos clientes', r.status === 409 && r.data.code === 'ROTEIRO_ENCERRADO', r.data)

console.log('Alteração de ordem e substituição (outro promotor)')
const promotor2 = await login('promotor2')
const day2 = (await call(promotor2, 'GET', '/promotor/day')).data
const pending2 = day2.visits.filter((v: any) => v.status === 'PENDENTE')
const newOrder = [pending2[1].id, pending2[0].id, ...pending2.slice(2).map((v: any) => v.id)]
r = await call(promotor2, 'POST', '/promotor/requests', { type: 'ALTERAR_ORDEM', payload: { order: newOrder }, reason: 'Cliente 2 só recebe até 10h' })
check('pedido de inversão criado', r.status === 200, r.data)
r = await call(supervisor, 'POST', `/supervisor/requests/${r.data.id}/decide`, { approve: true })
check('inversão aprovada', r.status === 200 && r.data.status === 'APROVADA', r.data)
check('ordem invertida', (await call(promotor2, 'GET', '/promotor/day')).data.nextVisitId === pending2[1].id)

console.log('Regras por promotor e ordem do roteiro por dia da semana')
const promotor2Id = day2.visits[0].promotorId ?? (await call(promotor2, 'GET', '/auth/me')).data.id
const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
r = await call(admin, 'PUT', '/admin/settings', {
  values: { geofenceRadiusMeters: 400, enforceRouteOrderWeekdays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== weekday) },
  promotorIds: [promotor2Id],
})
check('exceção gravada só para o promotor escolhido', r.status === 200 && r.data.overrides.some((o: any) => o.promotor.id === promotor2Id), r.data)
let rules2 = (await call(promotor2, 'GET', '/promotor/day')).data
let rules3 = (await call(promotor, 'GET', '/promotor/day')).data
check('promotor com exceção usa a regra dele', rules2.rules.geofenceRadiusMeters === 400 && rules2.rules.enforceRouteOrder === false && rules2.nextVisitId === null, rules2.rules)
check('outros promotores seguem a regra geral', rules3.rules.geofenceRadiusMeters === 150 && rules3.rules.enforceRouteOrder === true, rules3.rules)
r = await call(admin, 'PUT', '/admin/settings', { values: { photoScoreMax: 5 }, promotorIds: [promotor2Id] })
check('regra do painel não aceita exceção por promotor', r.status === 400, r.data)
r = await call(admin, 'POST', '/admin/settings/overrides/clear', { promotorIds: [promotor2Id] })
check('exceções removidas', r.status === 200 && !r.data.overrides.some((o: any) => o.promotor.id === promotor2Id), r.data)
rules2 = (await call(promotor2, 'GET', '/promotor/day')).data
check('promotor voltou à regra geral', rules2.rules.geofenceRadiusMeters === 150 && rules2.rules.enforceRouteOrder === true, rules2.rules)
const settingsData = (await call(admin, 'GET', '/admin/settings')).data
check('painel recebe os vendedores atendidos por promotor', Object.keys(settingsData.promotorSellers).length >= 3, settingsData.promotorSellers)

console.log('Justificativa como volta do almoço (na cerca)')
const supervisorId = (await call(supervisor, 'GET', '/auth/me')).data.id
let testUser = await call(admin, 'POST', '/admin/users', { name: 'Promotor Teste', login: 'promotor.teste', password: '123456', role: 'PROMOTOR', supervisorId })
const testId = testUser.status === 200 ? testUser.data.id : (await call(admin, 'GET', '/admin/users?search=promotor.teste')).data[0].id
const testClients = ((await call(admin, 'GET', '/admin/clients?pageSize=200')).data.items as any[]).slice(-3)
await call(admin, 'PUT', `/admin/routes/${testId}/${weekday}`, { clientIds: testClients.map((c) => c.id) })
const tester = await login('promotor.teste')
const tDay = (await call(tester, 'GET', '/promotor/day')).data
const [t1, t2, t3] = tDay.visits
r = await call(tester, 'POST', `/promotor/visits/${t1.id}/checkin`, checkinForm(near(t1.client)))
check('teste: primeiro atendimento aberto', r.status === 200, r.data)
await call(supervisor, 'POST', '/supervisor/permissions', { promotorId: testId, type: 'DISPENSA_FOTOS', visitId: t1.id, note: 'teste' })
r = await call(tester, 'POST', `/promotor/visits/${t1.id}/checkout`, near(t1.client))
check('teste: primeiro atendimento encerrado', r.status === 200, r.data)
r = await call(tester, 'POST', '/promotor/lunch/start', near(t1.client))
check('teste: almoço aberto', r.status === 200, r.data)

// Almoço passando de 2h: o servidor confere a cada minuto; aqui simula o relógio 2h01 depois
await checkLunchAlerts(new Date(Date.now() + 119 * 60_000))
let alerts = (await call(supervisor, 'GET', '/supervisor/alerts')).data as any[]
check('sem alerta antes de 2h de almoço', !alerts.some((a) => a.promotor.id === testId), alerts)
await checkLunchAlerts(new Date(Date.now() + 121 * 60_000))
alerts = (await call(supervisor, 'GET', '/supervisor/alerts')).data as any[]
const lunchAlert = alerts.find((a) => a.promotor.id === testId && a.type === 'ALMOCO_LONGO')
check('supervisor alertado depois de 2h de almoço', !!lunchAlert && !lunchAlert.resolvedAt, alerts)
check('resumo do supervisor conta o alerta', (await call(supervisor, 'GET', '/supervisor/summary')).data.openAlerts >= 1)
check('alerta aparece no painel (Hoje)', (await call(admin, 'GET', '/admin/dashboard')).data.alerts.some((a: any) => a.id === lunchAlert?.id))
r = await call(supervisor, 'POST', `/supervisor/alerts/${lunchAlert.id}/ack`, {})
check('supervisor marcou ciente', r.status === 200 && !!r.data.acknowledgedAt && r.data.acknowledgedBy, r.data)
const farAway = { latitude: t2.client.latitude + 0.05, longitude: t2.client.longitude }
r = await call(tester, 'POST', `/promotor/visits/${t2.id}/justify`, { reasonId, text: 'Loja fechada para inventário hoje à tarde.', ...farAway })
check('justificar longe das lojas no almoço recusado', r.status === 422 && r.data.code === 'FORA_DA_CERCA', r.data)
r = await call(tester, 'POST', `/promotor/visits/${t2.id}/justify`, { reasonId, text: 'Loja fechada para inventário hoje à tarde.' })
check('justificar no almoço sem GPS recusado', r.status === 422 && r.data.code === 'LOCALIZACAO_OBRIGATORIA', r.data)
r = await call(tester, 'POST', `/promotor/visits/${t2.id}/justify`, { reasonId, text: 'Loja fechada para inventário hoje à tarde.', ...near(t3.client) })
check('justificar na cerca do cliente seguinte aceito', r.status === 200 && r.data.status === 'JUSTIFICADA', r.data)
check('justificativa encerrou o almoço', !!(await call(tester, 'GET', '/promotor/day')).data.workDay.lunchEndedAt)
alerts = (await call(supervisor, 'GET', '/supervisor/alerts?state=todos')).data as any[]
check('alerta resolvido quando o promotor voltou', !!alerts.find((a) => a.id === lunchAlert.id)?.resolvedAt, alerts.find((a) => a.id === lunchAlert.id))
const testReport = (await call(admin, 'GET', `/admin/reports/visits?promotorId=${testId}&from=${today}&to=${today}`)).data
check('jornada marca almoço acima do limite', testReport.days[0]?.lunchOverdue === true, testReport.days[0])

console.log('Rastreamento e mapa')
r = await call(promotor, 'POST', '/tracking/pings', { pings: [{ ...loc1, recordedAt: new Date().toISOString(), battery: 0.8 }] })
check('ping recebido', r.status === 200 && r.data.received === 1, r.data)
r = await call(admin, 'GET', '/admin/map')
check('mapa com promotores e clientes', r.status === 200 && r.data.promotores.length >= 3 && r.data.visits.length > 0, r.data)

console.log('Auditoria vendedor e supervisor')
r = await call(vendedor, 'GET', '/audit/photos?status=pendentes')
check('vendedor lista fotos pendentes', r.status === 200, r.data)
const photo = r.data.items[0]
if (photo) {
  r = await call(vendedor, 'POST', `/audit/photos/${photo.id}`, { status: 'REPROVADA' })
  check('reprovação sem justificativa recusada', r.status === 400, r.data)
  r = await call(vendedor, 'POST', `/audit/photos/${photo.id}`, { status: 'REPROVADA', justification: 'Foto escura demais' })
  check('vendedor reprovou', r.status === 200 && r.data.myAudit.status === 'REPROVADA', r.data)
}
r = await call(supervisor, 'GET', '/supervisor/vendor-audits?state=pendentes')
check('supervisor lista auditorias para conferir', r.status === 200 && r.data.items.length > 0, r.data)
r = await call(supervisor, 'POST', `/supervisor/vendor-audits/${r.data.items[0].id}/review`, { verdict: 'INCORRETA', comment: 'A foto está boa, deveria aprovar.' })
check('supervisor marcou auditoria incorreta', r.status === 200 && r.data.review.verdict === 'INCORRETA', r.data)

console.log('Painel: produtos, mix, relatórios, regras e PDF')
r = await call(admin, 'GET', '/admin/products')
check('catálogo de produtos', r.status === 200 && r.data.items.length > 0, r.data)
r = await call(admin, 'POST', '/admin/mix/import', { rows: [{ clientCode: first.client.code, productCode: 'P001' }, { clientCode: '99999', productCode: 'P001' }] })
check('importação de mix (com código desconhecido)', r.status === 200 && r.data.clients === 1 && r.data.unknownClients.includes('99999'), r.data)
r = await call(admin, 'GET', `/admin/clients/${first.client.id}/mix`)
check('mix substituído pelo do arquivo', r.status === 200 && r.data.length === 1 && r.data[0].code === 'P001', r.data)
r = await call(admin, 'GET', '/admin/reports/visits')
check('relatório com resumo por promotor', r.status === 200 && r.data.summary.length >= 3, r.data.summary)
check('relatório mostra encerramento automático e rupturas', r.data.rows.some((x: any) => x.autoClosed) && r.data.rows.some((x: any) => x.ruptures.length > 0))
const firstOfDay = r.data.rows.filter((x: any) => x.checkinAt).sort((a: any, b: any) => a.checkinAt.localeCompare(b.checkinAt))[0]
check('primeiro cliente do dia sem deslocamento', firstOfDay.travelMin === null, firstOfDay)
const myDay = r.data.days.find((d: any) => d.promotor.id === promotorId && d.date === today)
check('jornada com ponto de início, almoço e horas trabalhadas', !!myDay?.workStart && !!myDay?.workEnd && myDay?.lunchMin != null && myDay?.workedMin != null, myDay)
check('deslocamento depois do almoço marcado', r.data.rows.some((x: any) => x.promotor.id === promotorId && x.date === today && x.afterLunch), null)
r = await call(admin, 'GET', '/admin/photos?reviewed=false')
check('fotos para avaliar', r.status === 200 && r.data.items.length > 0)
r = await call(admin, 'PATCH', `/admin/photos/${r.data.items[0].id}/review`, { score: 8, notes: 'Boa foto' })
check('foto avaliada', r.status === 200 && r.data.score === 8, r.data)
r = await call(admin, 'GET', '/admin/settings')
check('novas regras no painel', r.data.values.requireFacadePhotoOnCheckin === true && r.data.values.enforceVisitSequence === true && r.data.meta.autoCloseForgottenVisit)
r = await call(supervisor, 'PUT', '/admin/settings', { geofenceRadiusMeters: 999 })
check('supervisor não altera regras', r.status === 403, r.data)
const vend = (await call(admin, 'GET', '/admin/lookups')).data.vendedores.find((v: any) => v.name === 'Carlos Menezes')
r = await call(admin, 'GET', `/admin/audit-errors/pdf?vendedorId=${vend.id}`)
const pdf = Buffer.from(r.data as ArrayBuffer)
check('PDF gerado', r.status === 200 && pdf.subarray(0, 4).toString() === '%PDF', { status: r.status, size: pdf.length })

await prisma.$disconnect()
console.log(failures === 0 ? '\nTudo certo.' : `\n${failures} verificação(ões) falharam.`)
process.exit(failures === 0 ? 0 : 1)
