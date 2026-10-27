/** Regras de parcelamento e faturas (porte de backend/database.py). Datas são strings 'AAAA-MM-DD'. */

export interface CartaoRegra {
  dia_fechamento: number
  dia_vencimento: number
}

export const CATEGORIAS_PADRAO = [
  'Alimentação', 'Mercado', 'Transporte', 'Combustível', 'Moradia', 'Saúde',
  'Educação', 'Lazer', 'Vestuário', 'Assinaturas', 'Eletrônicos', 'Viagem',
  'Presentes', 'Outros',
]

const p2 = (n: number) => String(n).padStart(2, '0')
export const iso = (ano: number, mes: number, dia: number) => `${String(ano).padStart(4, '0')}-${p2(mes)}-${p2(dia)}`
export const mesIso = (ano: number, mes: number) => `${String(ano).padStart(4, '0')}-${p2(mes)}`
export const partes = (data: string) => data.split('-').map(Number) as [number, number, number]

export function hoje(): string {
  const d = new Date()
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

export function somarMeses(ano: number, mes: number, n: number): [number, number] {
  const idx = ano * 12 + (mes - 1) + n
  return [Math.floor(idx / 12), (idx % 12) + 1]
}

const diasNoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate()

/** Cria a data limitando o dia ao último dia do mês (ex.: 31/02 -> 28/02). */
export function dataSegura(ano: number, mes: number, dia: number): string {
  return iso(ano, mes, Math.min(dia, diasNoMes(ano, mes)))
}

function somarDias(data: string, n: number): string {
  const [a, m, d] = partes(data)
  const dt = new Date(Date.UTC(a, m - 1, d + n))
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

/** Divide o total em n parcelas; a diferença de centavos vai na 1ª. */
export function dividirValor(total: number, n: number): number[] {
  const base = Math.floor(total / n)
  const valores = Array<number>(n).fill(base)
  valores[0] += total - base * n
  return valores
}

/** Vencimento de cada parcela: com cartão, compras a partir do fechamento entram na fatura seguinte. */
export function calcularVencimentos(dataCompra: string, n: number, cartao: CartaoRegra | null): string[] {
  const [a0, m0, d0] = partes(dataCompra)
  if (!cartao) return Array.from({ length: n }, (_, i) => dataSegura(...somarMeses(a0, m0, i), d0))
  const { dia_fechamento: fech, dia_vencimento: venc } = cartao
  let [ano, mes] = [a0, m0]
  if (d0 >= fech) [ano, mes] = somarMeses(ano, mes, 1)
  if (venc <= fech) [ano, mes] = somarMeses(ano, mes, 1)
  return Array.from({ length: n }, (_, i) => dataSegura(...somarMeses(ano, mes, i), venc))
}

/** Vencimentos pelo mês da 1ª parcela ('AAAA-MM'): com cartão é o mês da fatura; sem cartão, dia 1. */
export function vencimentosPorMes(mesRef: string, n: number, cartao: CartaoRegra | null): string[] {
  const [ano, mes] = mesRef.split('-').map(Number)
  if (!cartao) return Array.from({ length: n }, (_, i) => iso(...somarMeses(ano, mes, i), 1))
  return Array.from({ length: n }, (_, i) => cicloFatura(cartao, ...somarMeses(ano, mes, i)).vencimento)
}

export function vencimentosDespesa(
  dados: { mes_referencia?: string | null; num_parcelas: number; data_compra: string },
  cartao: CartaoRegra | null,
): string[] {
  if (dados.mes_referencia) return vencimentosPorMes(dados.mes_referencia, dados.num_parcelas, cartao)
  return calcularVencimentos(dados.data_compra, dados.num_parcelas, cartao)
}

// Uma fatura é identificada pelo mês em que o ciclo de compras COMEÇA.
const mesesAteVencimento = (c: CartaoRegra) => (c.dia_vencimento > c.dia_fechamento ? 1 : 2)

export interface Ciclo { inicio: string; fim: string; fechamento: string; vencimento: string }

export function cicloFatura(cartao: CartaoRegra, ano: number, mes: number): Ciclo {
  const inicio = dataSegura(ano, mes, cartao.dia_fechamento)
  const fechamento = dataSegura(...somarMeses(ano, mes, 1), cartao.dia_fechamento)
  const vencimento = dataSegura(...somarMeses(ano, mes, mesesAteVencimento(cartao)), cartao.dia_vencimento)
  return { inicio, fim: somarDias(fechamento, -1), fechamento, vencimento }
}

/** Mês de referência da fatura (início do ciclo) a partir da data de vencimento. */
export function referenciaPorVencimento(vencimento: string, cartao: CartaoRegra): [number, number] {
  const [a, m] = partes(vencimento)
  return somarMeses(a, m, -mesesAteVencimento(cartao))
}

/** Fatura em que uma compra feita hoje entraria. */
export function faturaAtual(cartao: CartaoRegra, dataHoje: string): [number, number] {
  const [a, m, d] = partes(dataHoje)
  return d >= cartao.dia_fechamento ? [a, m] : somarMeses(a, m, -1)
}
