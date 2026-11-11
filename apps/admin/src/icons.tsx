// Ícones do painel: Ionicons, o mesmo conjunto do app (briefing, seção 5). Só entram no build os ícones importados
// aqui; para usar outro, importe pelo nome de ionicons/icons e acrescente na lista.
import {
  arrowBack,
  arrowForward,
  barChartOutline,
  chatbubblesOutline,
  checkmarkDoneOutline,
  clipboardOutline,
  close,
  cubeOutline,
  documentTextOutline,
  imagesOutline,
  keyOutline,
  mapOutline,
  optionsOutline,
  peopleOutline,
  storefrontOutline,
  todayOutline,
  trailSignOutline,
} from 'ionicons/icons'

const icons = {
  'arrow-back': arrowBack,
  'arrow-forward': arrowForward,
  'bar-chart-outline': barChartOutline,
  'chatbubbles-outline': chatbubblesOutline,
  'checkmark-done-outline': checkmarkDoneOutline,
  'clipboard-outline': clipboardOutline,
  close,
  'cube-outline': cubeOutline,
  'document-text-outline': documentTextOutline,
  'images-outline': imagesOutline,
  'key-outline': keyOutline,
  'map-outline': mapOutline,
  'options-outline': optionsOutline,
  'people-outline': peopleOutline,
  'storefront-outline': storefrontOutline,
  'today-outline': todayOutline,
  'trail-sign-outline': trailSignOutline,
}

export type IconName = keyof typeof icons

/** O pacote entrega cada ícone como "data:image/svg+xml;utf8,<svg ...>": tira o prefixo e fica o SVG. */
const svgOf = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1)

/**
 * Ícone em linha com a cor do texto: 20px ao lado de texto (padrão) ou 24px sozinho. Sem `label`, é decorativo e fica
 * escondido do leitor de tela.
 */
export function Icon({ name, size = 20, label }: { name: IconName; size?: 20 | 24; label?: string }) {
  return (
    <span
      className="icon"
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      // SVG estático do pacote ionicons (não vem do usuário)
      dangerouslySetInnerHTML={{ __html: svgOf(icons[name]) }}
    />
  )
}
