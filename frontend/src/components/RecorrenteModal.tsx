import { useEffect, useState } from 'react'
import { api, type Cartao, type Recorrente } from '../api'
import { hojeISO } from '../format'
import { CampoDinheiro, Modal, Switch, TipoLancamento, type Rascunho } from './ui'

export function RecorrenteModal({ recorrente, inicial, onClose, onSalvo, onVirarCompra }: {
  recorrente?: Recorrente
  inicial?: Rascunho
  onClose: () => void
  onSalvo: () => void
  onVirarCompra?: (r: Rascunho) => void
}) {
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [descricao, setDescricao] = useState(recorrente?.descricao ?? inicial?.descricao ?? '')
  const [valor, setValor] = useState(recorrente?.valor_centavos ?? inicial?.valor ?? 0)
  const [dia, setDia] = useState(recorrente?.dia ?? 10)
  const [categoria, setCategoria] = useState(recorrente?.categoria ?? inicial?.categoria ?? '')
  const [cartaoId, setCartaoId] = useState<number | null>(recorrente ? recorrente.cartao_id : inicial?.cartaoId ?? null)
  const [inicio, setInicio] = useState(recorrente?.inicio ?? hojeISO().slice(0, 7))
  const [temFim, setTemFim] = useState(!!recorrente?.fim)
  const [fim, setFim] = useState(recorrente?.fim ?? '')
  const [observacao, setObservacao] = useState(recorrente?.observacao ?? '')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    api.cartoes(!recorrente).then(setCartoes)
    api.categorias().then(setCategorias)
  }, [recorrente])

  async function salvar() {
    setErro('')
    if (!descricao.trim()) return setErro('Informe a descrição.')
    if (valor <= 0) return setErro('Informe o valor.')
    if (!inicio) return setErro('Informe o mês de início.')
    if (temFim && !fim) return setErro('Informe o mês final ou desligue a opção.')
    const dados = {
      descricao: descricao.trim(), categoria: categoria.trim(), cartao_id: cartaoId, valor_centavos: valor,
      dia, inicio, fim: temFim ? fim : null, observacao: observacao.trim(),
    }
    setOcupado(true)
    try {
      if (recorrente) await api.editarRecorrente(recorrente.id, dados)
      else await api.criarRecorrente(dados)
      onSalvo()
      onClose()
    } catch (e) {
      setErro((e as Error).message)
      setOcupado(false)
    }
  }

  return (
    <Modal titulo={recorrente ? 'Editar recorrente' : 'Nova despesa'} onClose={onClose} rodape={<>
      {erro && <span className="error-msg">{erro}</span>}
      <div className="spacer" />
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={ocupado} onClick={salvar}>Salvar</button>
    </>}>
      <form style={{ display: 'contents' }} onSubmit={e => { e.preventDefault(); salvar() }}>
        {!recorrente && onVirarCompra && (
          <TipoLancamento tipo="recorrente" onChange={() => onVirarCompra({ descricao, valor, categoria, cartaoId })} />
        )}
        <label className="field">
          <span>Descrição</span>
          <input className="input" autoFocus value={descricao} placeholder="Ex.: Aluguel, internet, academia..."
            onChange={e => setDescricao(e.target.value)} />
        </label>

        <div className="grid-3">
          <label className="field">
            <span>Valor mensal</span>
            <CampoDinheiro valor={valor} onChange={setValor} />
          </label>
          <label className="field">
            <span>{cartaoId !== null ? 'Cobrado dia' : 'Vence dia'}</span>
            <input className="input num" type="number" min={1} max={31} value={dia}
              onChange={e => setDia(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
          <label className="field">
            <span>Categoria</span>
            <input className="input" list="categorias-rec" value={categoria} placeholder="Escolha ou digite"
              onChange={e => setCategoria(e.target.value)} />
            <datalist id="categorias-rec">{categorias.map(c => <option key={c} value={c} />)}</datalist>
          </label>
        </div>

        <label className="field">
          <span>Forma de pagamento</span>
          <select className="select" value={cartaoId ?? ''}
            onChange={e => setCartaoId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Sem cartão (boleto, Pix, débito automático)</option>
            {cartoes.map(c => <option key={c.id} value={c.id}>{c.nome}{c.bandeira ? ` · ${c.bandeira}` : ''}</option>)}
          </select>
        </label>
        {cartaoId !== null && (
          <div className="hint">No cartão, o dia informado é o dia da cobrança. O lançamento cai na fatura correspondente.</div>
        )}

        <div className="grid-2">
          <label className="field">
            <span>Começa em</span>
            <input className="input" type="month" value={inicio} onChange={e => setInicio(e.target.value)} />
          </label>
          <div className="field">
            <span>Termina em</span>
            {temFim
              ? <input className="input" type="month" value={fim} min={inicio} onChange={e => setFim(e.target.value)} />
              : <div className="input" style={{ display: 'flex', alignItems: 'center', color: 'var(--text-3)' }}>Sem data final</div>}
          </div>
        </div>
        <Switch ligado={temFim} onChange={v => { setTemFim(v); if (v && !fim) setFim(inicio) }}>
          Tem data para terminar (ex.: contrato de 12 meses)
        </Switch>

        <label className="field">
          <span>Observação</span>
          <textarea className="textarea" rows={2} value={observacao} onChange={e => setObservacao(e.target.value)} />
        </label>

        {recorrente && (
          <div className="hint">
            Ao salvar, os meses já pagos continuam como estão. Os meses em aberto a partir de agora passam a usar os novos dados.
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
