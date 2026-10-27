import { useEffect, useRef, useState } from 'react'
import { api, type Cartao, type ParcelaSimulada } from '../api'
import { brl, dataBR, hojeISO, mesAno, nomeFatura } from '../format'
import { CampoDinheiro, Modal, TipoLancamento, type Rascunho } from './ui'

const vazio = { descricao: '', categoria: '', observacao: '', valor: 0, parcelas: 1 }

export function DespesaModal({ despesaId, inicial, onClose, onSalvo, onVirarRecorrente }: {
  despesaId?: number
  inicial?: Rascunho
  onClose: () => void
  onSalvo: () => void
  /** ao criar, permite trocar para o formulário de recorrente levando o que já foi digitado */
  onVirarRecorrente?: (r: Rascunho) => void
}) {
  const editando = despesaId !== undefined
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [form, setForm] = useState({
    ...vazio, descricao: inicial?.descricao ?? '', valor: inicial?.valor ?? 0, categoria: inicial?.categoria ?? '',
  })
  const [modoParcela, setModoParcela] = useState(false)
  const [data, setData] = useState(hojeISO())
  // 'dia': vencimentos calculados pela data da compra; 'mes': informa direto o mês da 1ª parcela
  const [porMes, setPorMes] = useState(false)
  const [mes, setMes] = useState(hojeISO().slice(0, 7))
  const [cartaoId, setCartaoId] = useState<number | null>(inicial?.cartaoId ?? null)
  const [simulacao, setSimulacao] = useState<ParcelaSimulada[]>([])
  const [erro, setErro] = useState('')
  const [salvas, setSalvas] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const [competencia, setCompetencia] = useState<string | null>(null)
  const descRef = useRef<HTMLInputElement>(null)

  const total = modoParcela ? form.valor * form.parcelas : form.valor
  const set = <K extends keyof typeof vazio>(k: K, v: (typeof vazio)[K]) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    api.cartoes(!editando).then(setCartoes)
    api.categorias().then(setCategorias)
    if (despesaId !== undefined) {
      api.despesa(despesaId).then(d => {
        setForm({
          descricao: d.descricao, categoria: d.categoria ?? '', observacao: d.observacao,
          valor: d.valor_total_centavos, parcelas: d.num_parcelas,
        })
        setData(d.data_compra)
        setPorMes(!!d.mes_referencia)
        if (d.mes_referencia) setMes(d.mes_referencia)
        setCartaoId(d.cartao_id)
        setCompetencia(d.recorrente_id ? d.competencia : null)
      })
    }
  }, [despesaId, editando])

  const mesReferencia = porMes ? mes : null
  const dataCompra = porMes ? `${mes}-01` : data

  // simulação das parcelas (com pequeno atraso para não chamar a API a cada tecla)
  useEffect(() => {
    if (total <= 0 || (porMes ? !mes : !data)) { setSimulacao([]); return }
    const t = setTimeout(() => {
      api.simular(total, form.parcelas, dataCompra, cartaoId, mesReferencia).then(setSimulacao).catch(() => setSimulacao([]))
    }, 150)
    return () => clearTimeout(t)
  }, [total, form.parcelas, data, cartaoId, porMes, mes, dataCompra, mesReferencia])

  async function salvar(continuar: boolean) {
    setErro('')
    if (!form.descricao.trim()) return setErro('Informe a descrição.')
    if (total <= 0) return setErro('Informe um valor maior que zero.')
    if (porMes ? !mes : !data) return setErro(porMes ? 'Informe o mês da 1ª parcela.' : 'Informe a data da compra.')
    setOcupado(true)
    const dados = {
      descricao: form.descricao.trim(), categoria: form.categoria.trim(), observacao: form.observacao.trim(),
      cartao_id: cartaoId, valor_total_centavos: total, num_parcelas: form.parcelas,
      data_compra: dataCompra, mes_referencia: mesReferencia,
    }
    try {
      if (despesaId !== undefined) await api.editarDespesa(despesaId, dados)
      else await api.criarDespesa(dados)
    } catch (e) {
      setErro((e as Error).message)
      setOcupado(false)
      return
    }
    setOcupado(false)
    if (!continuar) {
      onSalvo()
      onClose()
      return
    }
    // mantém data e cartão para lançar várias em sequência
    setSalvas(n => n + 1)
    setForm(vazio)
    api.categorias().then(setCategorias)
    onSalvo()
    descRef.current?.focus()
  }

  const n = form.parcelas
  // a simulação chega com atraso: no preview usa o que ela tem, não o que está digitado
  const nSim = simulacao.length
  const ultima = simulacao[nSim - 1]

  return (
    <Modal
      titulo={competencia ? 'Lançamento recorrente' : editando ? 'Editar despesa' : 'Nova despesa'}
      onClose={onClose}
      rodape={<>
        {erro ? <span className="error-msg">{erro}</span>
          : salvas > 0 && <span className="status">{salvas} despesa(s) salva(s)</span>}
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>{salvas ? 'Fechar' : 'Cancelar'}</button>
        {!editando && <button className="btn" disabled={ocupado} onClick={() => salvar(true)}>Salvar e adicionar outra</button>}
        <button className="btn primary" disabled={ocupado} onClick={() => salvar(false)}>Salvar</button>
      </>}
    >
      <form className="modal-form" onSubmit={e => { e.preventDefault(); salvar(!editando) }}
        style={{ display: 'contents' }}>
        {!editando && onVirarRecorrente && (
          <TipoLancamento tipo="compra" onChange={() => onVirarRecorrente({
            descricao: form.descricao, valor: modoParcela ? form.valor : total, categoria: form.categoria, cartaoId,
          })} />
        )}
        {competencia && (
          <div className="notice">
            Este é o lançamento de <b>{mesAno(`${competencia}-01`)}</b> de uma despesa recorrente.
            Alterações aqui valem só para este mês. Para mudar todos os meses, use a página Recorrentes.
          </div>
        )}
        <label className="field">
          <span>Descrição</span>
          <input ref={descRef} className="input" autoFocus value={form.descricao}
            placeholder="Ex.: Geladeira, mercado, Netflix..."
            onChange={e => set('descricao', e.target.value)} />
        </label>

        <div className="grid-2">
          <label className="field">
            <span>Valor</span>
            <CampoDinheiro valor={form.valor} onChange={v => set('valor', v)} />
          </label>
          <div className="field">
            <span>O valor informado é</span>
            <div className="segmented">
              <button type="button" className={!modoParcela ? 'on' : ''} onClick={() => setModoParcela(false)}>Total</button>
              <button type="button" className={modoParcela ? 'on' : ''} onClick={() => setModoParcela(true)}>Por parcela</button>
            </div>
          </div>
        </div>

        <div className="grid-3">
          <label className="field">
            <span>Parcelas</span>
            <input className="input num" type="number" min={1} max={120} value={n} disabled={!!competencia}
              onChange={e => set('parcelas', Math.min(120, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
          <div className="field">
            <span className="field-head">
              {porMes ? (cartaoId !== null ? 'Fatura da 1ª parcela' : 'Mês da 1ª parcela') : 'Data da compra'}
              {!competencia && (
                <span className="segmented mini">
                  <button type="button" className={!porMes ? 'on' : ''} onClick={() => setPorMes(false)}>Dia</button>
                  <button type="button" className={porMes ? 'on' : ''} onClick={() => setPorMes(true)}>Mês</button>
                </span>
              )}
            </span>
            {porMes
              ? <input className="input" type="month" value={mes} onChange={e => setMes(e.target.value)} />
              : <input className="input" type="date" value={data} onChange={e => setData(e.target.value)} />}
          </div>
          <label className="field">
            <span>Categoria</span>
            <input className="input" list="categorias" value={form.categoria} placeholder="Escolha ou digite"
              onChange={e => set('categoria', e.target.value)} />
            <datalist id="categorias">{categorias.map(c => <option key={c} value={c} />)}</datalist>
          </label>
        </div>

        <label className="field">
          <span>Cartão</span>
          <select className="select" value={cartaoId ?? ''}
            onChange={e => setCartaoId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Sem cartão (Pix, dinheiro, débito)</option>
            {cartoes.map(c => (
              <option key={c.id} value={c.id}>
                {c.nome}{c.bandeira ? ` · ${c.bandeira}` : ''}{!c.ativo ? ' (inativo)' : ''}
                {` · fecha dia ${c.dia_fechamento}, vence dia ${c.dia_vencimento}`}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Observação</span>
          <textarea className="textarea" rows={2} value={form.observacao}
            onChange={e => set('observacao', e.target.value)} />
        </label>

        {simulacao.length > 0 ? (
          <div className="preview">
            <div className="headline">
              <strong className="num">
                {nSim > 1 ? `${nSim}× de ${brl(ultima.valor_centavos)}` : `À vista · ${brl(total)}`}
              </strong>
              <span className="muted num">
                {simulacao[0].fatura
                  ? `${nSim > 1 ? '1ª na ' : ''}fatura de ${nomeFatura(simulacao[0].fatura).toLowerCase()} · vence ${dataBR(simulacao[0].vencimento)}`
                  : nSim > 1 ? `${mesAno(simulacao[0].vencimento)} → ${mesAno(ultima.vencimento)}` : `vence ${dataBR(simulacao[0].vencimento)}`}
              </span>
            </div>
            {nSim > 1 && (
              <ol>
                {simulacao.map(p => (
                  <li key={p.numero} className="num">
                    <span>{p.numero}ª · {p.fatura ? `fat. ${nomeFatura(p.fatura, false).slice(0, 3).toLowerCase()}` : dataBR(p.vencimento).slice(0, 5)}</span>
                    <span>{brl(p.valor_centavos)}</span>
                  </li>
                ))}
              </ol>
            )}
            {nSim > 1 && <div className="hint" style={{ marginTop: 8 }}>Total {brl(total)}</div>}
          </div>
        ) : (
          <div className="hint">Informe o valor para ver em quais faturas as parcelas vão cair.</div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
