import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/* Diálogos del sistema (reemplazan a window.confirm/prompt): basados en
   promesas para usarse igual de fácil que los nativos, pero con la cara de
   la casa. Montar <DialogoHost/> una vez; llamar confirmar()/pedir()/elegir()
   desde cualquier lugar. */

type Opcion = { valor: string; label: string; detalle?: string }
type Peticion =
  | { tipo: 'confirmar'; titulo: string; mensaje?: string; aceptar?: string; cancelar?: string; tono?: 'normal' | 'peligro'; resolver: (v: boolean) => void }
  | { tipo: 'pedir'; titulo: string; mensaje?: string; placeholder?: string; valor?: string; inputMode?: 'text' | 'decimal'; resolver: (v: string | null) => void }
  | { tipo: 'elegir'; titulo: string; mensaje?: string; opciones: Opcion[]; multiple?: boolean; vacioLabel?: string; resolver: (v: string[] | null) => void }

let empujar: ((p: Peticion) => void) | null = null

export const confirmar = (o: { titulo: string; mensaje?: string; aceptar?: string; cancelar?: string; tono?: 'normal' | 'peligro' }) =>
  new Promise<boolean>(res => empujar ? empujar({ tipo: 'confirmar', ...o, resolver: res }) : res(window.confirm(o.titulo)))

export const pedir = (o: { titulo: string; mensaje?: string; placeholder?: string; valor?: string; inputMode?: 'text' | 'decimal' }) =>
  new Promise<string | null>(res => empujar ? empujar({ tipo: 'pedir', ...o, resolver: res }) : res(window.prompt(o.titulo, o.valor || '')))

export const elegir = (o: { titulo: string; mensaje?: string; opciones: Opcion[]; multiple?: boolean; vacioLabel?: string }) =>
  new Promise<string[] | null>(res => empujar ? empujar({ tipo: 'elegir', ...o, resolver: res }) : res(null))

export default function DialogoHost() {
  const [cola, setCola] = useState<Peticion[]>([])
  const [texto, setTexto] = useState('')
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const actual = cola[0] || null

  useEffect(() => {
    empujar = p => setCola(c => [...c, p])
    return () => { empujar = null }
  }, [])
  useEffect(() => {
    if (actual?.tipo === 'pedir') setTexto(actual.valor || '')
    if (actual?.tipo === 'elegir') setMarcadas(new Set())
  }, [actual])

  if (!actual) return null
  const cerrar = () => setCola(c => c.slice(1))
  const cancelar = () => {
    if (actual.tipo === 'confirmar') actual.resolver(false)
    else actual.resolver(null)
    cerrar()
  }

  return createPortal(
    <div className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6" onClick={cancelar}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-sm bg-surface border border-edge rounded-2xl p-6 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
        <h2 className="text-[16.5px] font-extrabold text-ink leading-snug">{actual.titulo}</h2>
        {actual.mensaje && <p className="text-[13.5px] text-mute mt-2 leading-relaxed whitespace-pre-line">{actual.mensaje}</p>}

        {actual.tipo === 'pedir' && (
          <input autoFocus value={texto} inputMode={actual.inputMode === 'decimal' ? 'decimal' : undefined}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { actual.resolver(texto); cerrar() } }}
            placeholder={actual.placeholder}
            className="mt-4 w-full h-[44px] px-3.5 rounded-xl border border-edge bg-app text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/60 transition-colors" />
        )}

        {actual.tipo === 'elegir' && (
          <div className="mt-4 flex flex-col gap-2 max-h-[300px] overflow-y-auto">
            {actual.opciones.map(op => {
              const activa = marcadas.has(op.valor)
              return (
                <button key={op.valor}
                  onClick={() => {
                    if (actual.multiple) {
                      setMarcadas(prev => { const n = new Set(prev); if (n.has(op.valor)) n.delete(op.valor); else n.add(op.valor); return n })
                    } else { actual.resolver([op.valor]); cerrar() }
                  }}
                  className={`text-left px-4 py-3 rounded-xl border transition-colors ${activa ? 'border-gold bg-gold-soft' : 'border-edge bg-app hover:border-gold/50'}`}>
                  <span className="text-[14px] font-bold text-ink block">{op.label}</span>
                  {op.detalle && <span className="text-[12px] text-mute block mt-0.5">{op.detalle}</span>}
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-5 flex gap-2.5 justify-end">
          <button onClick={cancelar} className="h-[42px] px-4 rounded-xl border border-edge text-[13.5px] font-semibold text-ink hover:bg-surface-2 transition-colors">
            {(actual.tipo === 'confirmar' && actual.cancelar) || 'Cancelar'}
          </button>
          {actual.tipo === 'confirmar' && (
            <button onClick={() => { actual.resolver(true); cerrar() }}
              className={`h-[42px] px-5 rounded-xl text-[13.5px] font-bold transition-opacity hover:opacity-90 ${actual.tono === 'peligro' ? 'bg-red-600 text-white' : 'bg-gold text-black'}`}>
              {actual.aceptar || 'Aceptar'}
            </button>
          )}
          {actual.tipo === 'pedir' && (
            <button onClick={() => { actual.resolver(texto); cerrar() }}
              className="h-[42px] px-5 rounded-xl bg-gold text-black text-[13.5px] font-bold hover:opacity-90 transition-opacity">Aceptar</button>
          )}
          {actual.tipo === 'elegir' && (actual.multiple || actual.vacioLabel) && (
            <button onClick={() => { actual.resolver([...marcadas]); cerrar() }}
              className="h-[42px] px-5 rounded-xl bg-gold text-black text-[13.5px] font-bold hover:opacity-90 transition-opacity">
              {marcadas.size ? `Aceptar (${marcadas.size})` : (actual.vacioLabel || 'Continuar sin elegir')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
