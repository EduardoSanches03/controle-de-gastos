import { useState } from 'react'
import { api, type Cartao } from '../api'
import { CampoDinheiro, Modal, Switch } from './ui'

const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`

const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'American Express', 'Hipercard']

export function CartaoModal({ cartao, onClose, onSalvo }: {
  cartao?: Cartao
  onClose: () => void
  onSalvo: () => void
}) {
  const [nome, setNome] = useState(cartao?.nome ?? '')
  const [bandeira, setBandeira] = useState(cartao?.bandeira ?? '')
  const [fechamento, setFechamento] = useState(cartao?.dia_fechamento ?? 1)
  const [vencimento, setVencimento] = useState(cartao?.dia_vencimento ?? 10)
  const [limite, setLimite] = useState(cartao?.limite_centavos ?? 0)
  const [ativo, setAtivo] = useState(cartao ? !!cartao.ativo : true)
  const [erro, setErro] = useState('')

  const dia = (v: string) => Math.min(31, Math.max(1, Number(v) || 1))

  async function salvar() {
    if (!nome.trim()) return setErro('Informe o nome do cartão.')
    const dados = {
      nome: nome.trim(), bandeira: bandeira.trim(), dia_fechamento: fechamento,
      dia_vencimento: vencimento, limite_centavos: limite, ativo,
    }
    try {
      if (cartao) await api.editarCartao(cartao.id, dados)
      else await api.criarCartao(dados)
      onSalvo()
      onClose()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  return (
    <Modal titulo={cartao ? 'Editar cartão' : 'Novo cartão'} onClose={onClose} pequeno rodape={<>
      {erro && <span className="error-msg">{erro}</span>}
      <div className="spacer" />
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <button className="btn primary" onClick={salvar}>Salvar</button>
    </>}>
      <form style={{ display: 'contents' }} onSubmit={e => { e.preventDefault(); salvar() }}>
        <label className="field">
          <span>Nome</span>
          <input className="input" autoFocus value={nome} placeholder="Ex.: Nubank, Itaú Platinum"
            onChange={e => setNome(e.target.value)} />
        </label>
        <label className="field">
          <span>Bandeira</span>
          <input className="input" list="bandeiras" value={bandeira} placeholder="Opcional"
            onChange={e => setBandeira(e.target.value)} />
          <datalist id="bandeiras">{BANDEIRAS.map(b => <option key={b} value={b} />)}</datalist>
        </label>
        <div className="grid-2">
          <label className="field">
            <span>Dia em que vira (fechamento)</span>
            <input className="input num" type="number" min={1} max={31} value={fechamento}
              onChange={e => setFechamento(dia(e.target.value))} />
          </label>
          <label className="field">
            <span>Dia de pagamento (vencimento)</span>
            <input className="input num" type="number" min={1} max={31} value={vencimento}
              onChange={e => setVencimento(dia(e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span>Limite</span>
          <CampoDinheiro valor={limite} onChange={setLimite} />
        </label>
        <Switch ligado={ativo} onChange={setAtivo}>Cartão ativo</Switch>
        <div className="hint">
          Ex.: vira dia {fechamento} e vence dia {vencimento}. A fatura de outubro tem as compras
          de {ddmm(new Date(2026, 9, fechamento))} a {ddmm(new Date(2026, 10, fechamento - 1))} e
          é paga em {ddmm(new Date(2026, vencimento > fechamento ? 10 : 11, vencimento))}.
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
