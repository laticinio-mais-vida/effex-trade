import { useRouter } from 'expo-router'
import { Alert } from 'react-native'
import { Muted, Screen } from '@/components/ui'
import { ClientSearch } from '@/features/ClientSearch'
import { useDay } from '@/features/promotor/DayContext'
import { api, ApiError, errorMessage } from '@/lib/api'
import type { Client, Visit } from '@/lib/types'

/** Visita de hoje que impede incluir o cliente de novo (a API recusa: o caminho é abrir ou reabrir a visita). */
function blockingVisit(visits: Visit[], clientId: string) {
  return visits.find((v) => v.client.id === clientId && (v.status === 'PENDENTE' || v.status === 'EM_ATENDIMENTO' || v.status === 'CONCLUIDA'))
}

export default function AdicionarCliente() {
  const router = useRouter()
  const { day, reload } = useDay()
  const visits = day?.visits ?? []

  function goToVisit(visitId: string) {
    router.replace(`/promotor/visita/${visitId}`)
  }

  function select(client: Client) {
    const existing = blockingVisit(visits, client.id)
    if (existing) {
      // Cliente já no dia: não repete, leva para a visita (concluída = reabrir e continuar de onde parou)
      goToVisit(existing.id)
      return
    }
    const justified = visits.some((v) => v.client.id === client.id && v.status === 'JUSTIFICADA')
    Alert.alert('Incluir cliente extra?', `${client.name}${justified ? '\n\nEste cliente foi justificado hoje. Será incluída uma nova visita.' : ''}`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Incluir',
        onPress: async () => {
          try {
            await api('/promotor/visits', { body: { clientId: client.id } })
            await reload()
            router.back()
          } catch (e) {
            if (e instanceof ApiError && e.code === 'CLIENTE_NO_ROTEIRO' && e.details?.visitId) {
              const visitId: string = e.details.visitId
              Alert.alert('Cliente já está no seu dia', e.message, [
                { text: 'Fechar', style: 'cancel' },
                { text: 'Ir para o cliente', onPress: () => goToVisit(visitId) },
              ])
              void reload()
              return
            }
            Alert.alert('Não foi possível incluir', errorMessage(e))
          }
        },
      },
    ])
  }

  return (
    <Screen>
      <Muted>
        Clientes extras entram no fim da lista e podem ser atendidos a qualquer momento
        {day ? ` (limite de ${day.rules.maxExtraVisitsPerDay} por dia)` : ''}. Para voltar a um cliente já atendido hoje, toque nele e reabra o atendimento.
      </Muted>
      <ClientSearch
        fetcher={(search) => api<Client[]>(`/promotor/clients${search ? `?search=${encodeURIComponent(search)}` : ''}`)}
        onSelect={select}
        note={(c) => {
          const existing = blockingVisit(visits, c.id)
          if (!existing) return visits.some((v) => v.client.id === c.id && v.status === 'JUSTIFICADA') ? 'Justificado hoje: pode incluir de novo' : null
          if (existing.status === 'CONCLUIDA') return 'Atendido hoje: toque para reabrir'
          if (existing.status === 'EM_ATENDIMENTO') return 'Em atendimento agora: toque para abrir'
          return 'No roteiro de hoje: toque para abrir'
        }}
      />
    </Screen>
  )
}
