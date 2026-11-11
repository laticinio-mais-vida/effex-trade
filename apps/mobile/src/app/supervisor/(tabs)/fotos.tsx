import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Segmented } from '@/components/ui'
import { PhotoAuditScreen } from '@/features/audit/PhotoAuditScreen'
import { VendorAuditScreen } from '@/features/audit/VendorAuditScreen'
import { ContestScreen } from '@/features/contests/ContestScreen'
import { colors, space } from '@/lib/theme'

type Section = 'avaliar' | 'vendedores' | 'contestacoes'
const SECTIONS: Section[] = ['avaliar', 'vendedores', 'contestacoes']

/** Aba Fotos do supervisor: avaliar as fotos, conferir as auditorias dos vendedores e decidir as contestações. */
export default function SupervisorFotos() {
  // ?secao=vendedores abre direto numa das partes (ex.: tocar num vendedor na Equipe)
  const { secao } = useLocalSearchParams<{ secao?: string }>()
  const [section, setSection] = useState<Section>('avaliar')
  useEffect(() => {
    if (secao && (SECTIONS as string[]).includes(secao)) setSection(secao as Section)
  }, [secao])

  return (
    <View style={{ flex: 1, backgroundColor: colors.fundo }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
        <Segmented
          value={section}
          onChange={setSection}
          options={[
            { value: 'avaliar', label: 'Avaliar' },
            { value: 'vendedores', label: 'Vendedores' },
            { value: 'contestacoes', label: 'Contestações' },
          ]}
        />
      </View>
      {section === 'avaliar' ? <PhotoAuditScreen /> : section === 'vendedores' ? <VendorAuditScreen /> : <ContestScreen />}
    </View>
  )
}
