/**
 * Alta de una orden de reparacion. La abren Reparaciones y Mi jornada —las dos
 * secciones perezosas—, asi que vive en su propio archivo: se descarga con la
 * primera de las dos que se abra y no lastra al resto del panel.
 */
import { useState } from 'react'
import Modal from '../../components/Modal'
import api from '../../lib/api'
import { soloTelefono } from '../../lib/utils'
import { motion } from 'framer-motion'
import { type Notify } from '../../store/toast'
import {
  type Empresa, type OrdenReparacion, type Unidad, empresasActivas, input,
  label,
} from './comun'

export function NuevaOrdenModal({ empresas, unidades, notify, onClose, onCreated }: {
  empresas: Empresa[]; unidades: Unidad[]; notify: Notify
  onClose: () => void; onCreated: (o: OrdenReparacion) => void
}) {
  const [tipo, setTipo] = useState<'cliente' | 'interna'>('cliente')
  const [form, setForm] = useState({ cliente_nombre: '', cliente_telefono: '', empresa: '', unidad: '', equipo_descripcion: '', numero_serie: '', diagnostico: '' })
  const [saving, setSaving] = useState(false)

  function crear() {
    if (tipo === 'cliente' && !form.cliente_nombre.trim() && !form.empresa) { notify('Indica el nombre del cliente o la empresa', 'err'); return }
    if (tipo === 'cliente' && form.cliente_telefono.replace(/\D/g, '').length !== 10) {
      notify('El teléfono del cliente es obligatorio: la orden termina con una llamada de "ya está lista"', 'err'); return
    }
    if (tipo === 'cliente' && !form.equipo_descripcion.trim()) { notify('Describe el equipo del cliente', 'err'); return }
    if (tipo === 'interna' && !form.unidad) { notify('Selecciona la unidad propia', 'err'); return }
    setSaving(true)
    const payload: any = { tipo, diagnostico: form.diagnostico.trim() }
    if (tipo === 'interna') {
      payload.unidad = Number(form.unidad)
    } else {
      payload.cliente_nombre = form.cliente_nombre.trim()
      payload.cliente_telefono = form.cliente_telefono.trim()
      payload.equipo_descripcion = form.equipo_descripcion.trim()
      payload.numero_serie = form.numero_serie.trim()
      if (form.empresa) payload.empresa = Number(form.empresa)
    }
    api.post<OrdenReparacion>('/reparaciones/', payload)
      .then(r => { notify(`Orden ${r.data.folio} creada`); onCreated(r.data) })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo crear la orden', 'err'))
      .finally(() => setSaving(false))
  }

  return (
    <Modal className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClose={onClose} label="Nueva orden de reparación">
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[560px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-edge flex items-center justify-between shrink-0">
          <h2 className="font-bold text-ink">Nueva orden de reparación</h2>
          <button onClick={onClose} className="text-mute hover:text-ink p-1" aria-label="Cerrar"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setTipo('cliente')} className={`px-3 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${tipo === 'cliente' ? 'border-gold bg-gold-soft text-gold-ink' : 'border-edge text-mute hover:text-ink'}`}>Equipo de cliente</button>
            <button onClick={() => setTipo('interna')} className={`px-3 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${tipo === 'interna' ? 'border-gold bg-gold-soft text-gold-ink' : 'border-edge text-mute hover:text-ink'}`}>Máquina propia</button>
          </div>

          {tipo === 'cliente' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Cliente</label><input aria-label="Cliente" className={input} value={form.cliente_nombre} onChange={e => setForm({ ...form, cliente_nombre: e.target.value })} placeholder="Nombre del cliente" autoFocus /></div>
                {/* Requerido: la orden termina con una llamada de "ya está
                    lista", y sin número esa llamada no ocurre. */}
                <div><label className={label}>Teléfono *</label><input aria-label="Teléfono" aria-required="true" type="tel" inputMode="numeric" maxLength={10} className={input} value={form.cliente_telefono} onChange={e => setForm({ ...form, cliente_telefono: soloTelefono(e.target.value) })} placeholder="10 dígitos" /></div>
              </div>
              <div>
                <label className={label}>Empresa (opcional)</label>
                <select aria-label="Empresa (opcional)" className={input} value={form.empresa} onChange={e => setForm({ ...form, empresa: e.target.value })}>
                  <option value="">— Cliente particular —</option>
                  {empresasActivas(empresas).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className={label}>Equipo del cliente *</label><input aria-label="Equipo del cliente" aria-required="true" className={input} value={form.equipo_descripcion} onChange={e => setForm({ ...form, equipo_descripcion: e.target.value })} placeholder="Ej. Compresor Truper 100L" /></div>
                <div className="col-span-2"><label className={label}>Número de serie</label><input aria-label="Número de serie" className={input} value={form.numero_serie} onChange={e => setForm({ ...form, numero_serie: e.target.value })} placeholder="Opcional" /></div>
              </div>
            </>
          ) : (
            <div>
              <label className={label}>Unidad propia *</label>
              <select aria-label="Unidad propia" aria-required="true" className={input} value={form.unidad} onChange={e => setForm({ ...form, unidad: e.target.value })} autoFocus>
                <option value="">— Selecciona una unidad —</option>
                {/* Solo máquinas de RENTA (seminuevas). Las nuevas se venden, no se reparan aquí. */}
                {unidades.filter(u => (u.equipo_info?.modo ?? (u.condicion === 'seminueva' ? 'renta' : 'venta')) === 'renta').map(u => <option key={u.id} value={u.id}>{u.codigo} · {u.equipo_modelo || u.equipo_info?.modelo || ''}</option>)}
              </select>
              <p className="text-[11px] text-mute mt-1.5">Solo máquinas de <b>renta</b> (las nuevas se venden, no se reparan aquí). No requiere datos de cliente.</p>
            </div>
          )}

          <div><label className={label}>Falla reportada / diagnóstico inicial</label><textarea aria-label="Falla reportada / diagnóstico inicial" className={`${input} campo-area`} rows={3} value={form.diagnostico} onChange={e => setForm({ ...form, diagnostico: e.target.value })} placeholder="Qué reporta el cliente / síntomas" /></div>
        </div>
        <div className="px-6 py-4 border-t border-edge flex justify-end gap-3 shrink-0 bg-surface">
          <button onClick={onClose} className="px-6 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cancelar</button>
          <button onClick={crear} disabled={saving} className="px-7 py-2.5 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : null}
            Crear orden
          </button>
        </div>
      </motion.div>
    </Modal>
  )
}
