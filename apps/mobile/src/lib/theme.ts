import type { TextStyle, ViewStyle } from 'react-native'

/**
 * Base comum do visual do app (briefing da reformulação visual, seções 3 a 5). Cor, fonte e medida usadas nas telas
 * saem daqui; nenhuma tela deve ter valor fixo.
 */

const marinho = '#061D39'

export const colors = {
  /** Cor de ação: botão primário, links, aba ativa. Também o texto principal. */
  marinho,
  /** Verde da marca: só no logo. Na interface, verde significa "feito". */
  verdeMarca: '#25B827',
  /** Fundo das telas */
  fundo: '#FEF7EB',
  /** Cartões, campos, barras */
  superficie: '#FFFFFF',
  branco: '#FFFFFF',
  /** Fundo do visualizador de foto */
  preto: '#000000',
  texto: marinho,
  textoSecundario: '#475467',
  bordaCampo: '#8A93A3',
  /** Bordas de cartão e divisórias */
  divisoria: '#E6DFD1',
  desabilitadoTexto: '#5F6673',
  desabilitadoFundo: '#E7E4DD',
  /** Feito, Aprovada, Correta, Aceita */
  feito: '#146C34',
  feitoSuave: '#E3F4E8',
  /** Só para Justificado */
  justificado: '#8F5106',
  justificadoSuave: '#FBE3B8',
  emAtendimento: '#1D4ED8',
  emAtendimentoSuave: '#E0EAFF',
  /** Não feito (dias anteriores), Reprovada, erro, perigo */
  naoFeito: '#B42318',
  naoFeitoSuave: '#FDE7E4',
  /** Não feito (dia aberto), Pendente, A conferir */
  neutro: '#475467',
  neutroSuave: '#EEF0F3',
  /** Pino de justificado no mapa (número em marinho) */
  pinoJustificado: '#F2B705',
  /** Véu atrás de folhas e janelas */
  veu: 'rgba(6, 29, 57, 0.5)',

  // Nomes antigos, só durante a transição: apontam para os valores novos. Cada etapa troca os da sua tela.
  /** @deprecated use marinho */
  primary: marinho,
  /** @deprecated use marinho */
  primaryDark: marinho,
  /** @deprecated use neutroSuave */
  primarySoft: '#EEF0F3',
  /** @deprecated use fundo */
  bg: '#FEF7EB',
  /** @deprecated use superficie */
  surface: '#FFFFFF',
  /** @deprecated use divisoria */
  border: '#E6DFD1',
  /** @deprecated use texto */
  text: marinho,
  /** @deprecated use textoSecundario */
  muted: '#475467',
  /** @deprecated use bordaCampo */
  faint: '#8A93A3',
  /** @deprecated use naoFeito */
  danger: '#B42318',
  /** @deprecated use naoFeitoSuave */
  dangerSoft: '#FDE7E4',
  /** @deprecated use justificado (só para Justificado) */
  warning: '#8F5106',
  /** @deprecated use justificadoSuave (só para Justificado) */
  warningSoft: '#FBE3B8',
  /** @deprecated use emAtendimento */
  info: '#1D4ED8',
  /** @deprecated use emAtendimentoSuave */
  infoSoft: '#E0EAFF',
  /** @deprecated use feito */
  success: '#146C34',
  /** @deprecated use feitoSuave */
  successSoft: '#E3F4E8',
  /** @deprecated use neutroSuave */
  neutralSoft: '#EEF0F3',
}

/** Tons de status: cada um com a cor forte (texto, borda) e a suave (fundo). */
export type Tone = 'feito' | 'justificado' | 'emAtendimento' | 'naoFeito' | 'neutro'

export const tones: Record<Tone, { forte: string; suave: string }> = {
  feito: { forte: colors.feito, suave: colors.feitoSuave },
  justificado: { forte: colors.justificado, suave: colors.justificadoSuave },
  emAtendimento: { forte: colors.emAtendimento, suave: colors.emAtendimentoSuave },
  naoFeito: { forte: colors.naoFeito, suave: colors.naoFeitoSuave },
  neutro: { forte: colors.neutro, suave: colors.neutroSuave },
}

/**
 * Public Sans, carregada pelo expo-font em src/app/_layout.tsx. No Android cada peso é uma família: use a família do
 * peso e nunca fontWeight (que faria um negrito falso).
 */
export const fonts = {
  regular: 'PublicSans_400Regular',
  semibold: 'PublicSans_600SemiBold',
  bold: 'PublicSans_700Bold',
  boldItalic: 'PublicSans_700Bold_Italic',
}

/** Algarismos de largura igual: indicadores, tabelas e horários. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] }

/** Escala de texto (sp). O tamanho de letra do Android é respeitado: as telas cabem com a letra em até 130%. */
export const type = {
  /** Título da tela (único lugar com itálico) */
  titulo: { fontFamily: fonts.boldItalic, fontSize: 22, lineHeight: 28, color: colors.texto },
  /** Número de destaque */
  destaque: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, color: colors.texto, ...tabular },
  /** Nome do cliente ou título de seção */
  secao: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 23, color: colors.texto },
  /** Texto principal */
  texto: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, color: colors.texto },
  /** Texto principal com ênfase */
  textoForte: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.texto },
  /** Texto secundário */
  secundario: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.textoSecundario },
  /** Selo */
  selo: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  /** Rótulo de campo */
  rotulo: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.texto },
  botao: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20 },
  acaoTexto: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.marinho },
} satisfies Record<string, TextStyle>

/** Espaçamento: 4, 8, 12, 16, 24, 32. Margem lateral das telas = lg; entre cartões = sm. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }

export const radius = {
  /** Selos */
  sm: 6,
  /** Botões, campos e cartões */
  md: 10,
  /** Topo das folhas que sobem de baixo */
  folha: 16,
  /** @deprecated use md */
  lg: 10,
}

export const borders = {
  /** Cartões e divisórias */
  fina: 1,
  /** Campos */
  campo: 2,
  /** Botão secundário e Sair */
  botao: 3,
  /** Campo em foco, cartão do próximo cliente e do atendimento */
  destaque: 4,
}

/** Medidas mínimas de toque e de controles (dp). */
export const sizes = {
  /** Tudo que é tocável */
  toque: 48,
  /** Seletor (Pendentes / Auditadas / Todas) */
  seletor: 44,
  icone: 24,
  /** Ícone ao lado de texto */
  iconeComTexto: 20,
}

/** Sombra: só em janela, folha e barra fixa. Cartões se separam por borda. */
export const elevated: ViewStyle = {
  shadowColor: colors.marinho,
  shadowOpacity: 0.16,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: -2 },
  elevation: 8,
}
