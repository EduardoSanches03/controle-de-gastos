import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { decimal } from '../format'

export function Modal({ titulo, onClose, children, rodape, pequeno }: {
  titulo: string
  onClose: () => void
  children: ReactNode
  rodape?: ReactNode
  pequeno?: boolean
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal${pequeno ? ' sm' : ''}`} role="dialog" aria-label={titulo}>
        <div className="modal-head">
          <h2>{titulo}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {rodape && <div className="modal-foot">{rodape}</div>}
      </div>
    </div>
  )
}

export function Confirmar({ titulo, mensagem, textoConfirmar = 'Confirmar', onConfirmar, onClose }: {
  titulo: string
  mensagem: ReactNode
  textoConfirmar?: string
  onConfirmar: () => void | Promise<void>
  onClose: () => void
}) {
  const [ocupado, setOcupado] = useState(false)
  return (
    <Modal titulo={titulo} onClose={onClose} pequeno rodape={<>
      <div className="spacer" />
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={ocupado} autoFocus onClick={async () => {
        setOcupado(true)
        await onConfirmar()
        onClose()
      }}>{textoConfirmar}</button>
    </>}>
      <div className="muted">{mensagem}</div>
    </Modal>
  )
}

/** Campo de dinheiro: digita só números e ele formata como centavos (4500 -> 45,00). */
export function CampoDinheiro({ valor, onChange, autoFocus }: {
  valor: number
  onChange: (centavos: number) => void
  autoFocus?: boolean
}) {
  return (
    <input
      className="input num"
      inputMode="numeric"
      autoFocus={autoFocus}
      value={valor ? `R$ ${decimal(valor)}` : ''}
      placeholder="R$ 0,00"
      onChange={e => {
        const digitos = e.target.value.replace(/\D/g, '').slice(0, 11)
        onChange(digitos ? parseInt(digitos, 10) : 0)
      }}
    />
  )
}

export function Checkbox({ marcado, onChange, titulo }: { marcado: boolean; onChange: (v: boolean) => void; titulo?: string }) {
  return (
    <button
      type="button"
      className={`checkbox${marcado ? ' on' : ''}`}
      title={titulo}
      aria-pressed={marcado}
      onClick={e => { e.stopPropagation(); onChange(!marcado) }}
    >
      <Check size={12} strokeWidth={3} />
    </button>
  )
}

export function Switch({ ligado, onChange, children }: { ligado: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className={`switch${ligado ? ' on' : ''}`} onClick={() => onChange(!ligado)}>
      <i />{children}
    </label>
  )
}

/** Dados que passam de um formulário para o outro ao trocar Compra <-> Recorrente */
export interface Rascunho {
  descricao?: string
  valor?: number
  categoria?: string
  cartaoId?: number | null
}

export function TipoLancamento({ tipo, onChange }: { tipo: 'compra' | 'recorrente'; onChange: (t: 'compra' | 'recorrente') => void }) {
  return (
    <div className="segmented tipo-toggle">
      <button type="button" className={tipo === 'compra' ? 'on' : ''} onClick={() => onChange('compra')}>
        <i className="tipo-dot parcelada" /> Compra (à vista ou parcelada)
      </button>
      <button type="button" className={tipo === 'recorrente' ? 'on' : ''} onClick={() => onChange('recorrente')}>
        <i className="tipo-dot recorrente" /> Recorrente (todo mês)
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ toasts
const ToastCtx = createContext<(msg: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msgs, setMsgs] = useState<{ id: number; texto: string }[]>([])
  const mostrar = useCallback((texto: string) => {
    const id = Date.now() + Math.random()
    setMsgs(m => [...m, { id, texto }])
    setTimeout(() => setMsgs(m => m.filter(x => x.id !== id)), 4500)
  }, [])
  return (
    <ToastCtx.Provider value={mostrar}>
      {children}
      <div className="toasts">{msgs.map(m => <div key={m.id} className="toast">{m.texto}</div>)}</div>
    </ToastCtx.Provider>
  )
}
