import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { Badge, Card, Row, styles } from '@/components/ui'
import { formatDateTime, requestStatusInfo, sinceLabel } from '@/lib/format'
import { colors, space, type } from '@/lib/theme'
import type { PermissionRequest } from '@/lib/types'

/** Detalhes legíveis do payload de cada tipo de liberação. */
function PayloadDetails({ request }: { request: PermissionRequest }) {
  const p = request.payload
  if (!p) return null
  if (request.type === 'ALTERAR_ORDEM' && Array.isArray(p.to)) {
    return (
      <View style={{ gap: space.xs / 2 }}>
        <Text style={styles.label}>Nova ordem proposta</Text>
        {(p.to as string[]).map((name, i) => {
          const moved = Array.isArray(p.from) && p.from[i] !== name
          return (
            <Text key={`${name}-${i}`} style={moved ? [type.textoForte, { color: colors.marinho }] : styles.text}>
              {i + 1}. {name}
            </Text>
          )
        })}
      </View>
    )
  }
  if (request.type === 'SUBSTITUIR_CLIENTE' && p.clientName) {
    return (
      <Text style={styles.text}>
        Trocar <Text style={type.textoForte}>{p.replacedClientName ?? request.visit?.client.name}</Text> por <Text style={type.textoForte}>{p.clientName}</Text>
      </Text>
    )
  }
  return null
}

/** Pedido de liberação. Aguardando decisão, mostra há quanto tempo o promotor espera. */
export function RequestCard({ request, showPromotor, actions }: { request: PermissionRequest; showPromotor?: boolean; actions?: ReactNode }) {
  const status = requestStatusInfo[request.status]
  const direct = request.createdBy.role !== 'PROMOTOR'
  const waiting = request.status === 'PENDENTE' && !direct
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <Text style={[styles.sectionTitle, { flex: 1 }]}>{request.typeLabel}</Text>
        <Badge label={status.label} tone={status.tone} />
      </Row>
      {waiting ? <Text style={type.textoForte}>Aguardando {sinceLabel(request.createdAt)}</Text> : null}
      {showPromotor ? <Text style={type.textoForte}>{request.promotor.name}</Text> : null}
      {request.visit ? (
        <Text style={styles.text}>
          Cliente: {request.visit.client.name} (#{request.visit.position})
        </Text>
      ) : null}
      <PayloadDetails request={request} />
      {request.reason ? <Text style={styles.text}>"{request.reason}"</Text> : null}
      <Text style={styles.muted}>
        {direct ? `Liberação direta de ${request.createdBy.name}` : 'Pedido'} às <Text style={styles.number}>{formatDateTime(request.createdAt)}</Text>
      </Text>
      {request.decidedAt && !direct ? (
        <View style={{ gap: space.xs / 2, paddingTop: space.xs }}>
          <Text style={styles.muted}>
            {status.label} por {request.decidedBy?.name ?? 'supervisor'} às {formatDateTime(request.decidedAt)}
          </Text>
          {request.decisionNote ? <Text style={styles.text}>{request.decisionNote}</Text> : null}
        </View>
      ) : null}
      {actions}
    </Card>
  )
}
