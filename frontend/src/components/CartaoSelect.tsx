import type { Cartao, FiltroCartao } from '../api'

/** Select de filtro por cartão: todos / sem cartão / cada cartão */
export function FiltroCartaoSelect({ cartoes, valor, onChange }: {
  cartoes: Cartao[]
  valor: FiltroCartao
  onChange: (v: FiltroCartao) => void
}) {
  return (
    <select
      className="select"
      value={valor === null ? '' : String(valor)}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">Todos os cartões</option>
      <option value="0">Sem cartão</option>
      {cartoes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
    </select>
  )
}
