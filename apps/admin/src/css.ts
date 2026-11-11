/** Valor de uma variável da base (styles.css), para quem não lê CSS (ex.: linhas do mapa no Leaflet). */
export function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
