export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
  'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const numero = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const brl = (centavos: number) => moeda.format(centavos / 100)
export const decimal = (centavos: number) => numero.format(centavos / 100)

/** '2026-10-05' -> '05/10/2026' */
export const dataBR = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/** '2026-10-05' -> 'out/2026' */
export const mesAno = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1].slice(0, 3).toLowerCase()}/${iso.slice(0, 4)}`

export const hojeISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** '2026-10' -> 'Outubro 2026' (nome da fatura = mês em que o ciclo de compras começa) */
export const nomeFatura = (ref: string, comAno = true) => {
  const [a, m] = ref.split('-').map(Number)
  return `${MESES[m - 1]}${comAno ? ` ${a}` : ''}`
}
