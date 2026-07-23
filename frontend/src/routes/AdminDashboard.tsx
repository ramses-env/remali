import api from '../lib/api'
import { useEffect, useState } from 'react'

type Equipo = {
  id?: number
  modelo: string
  descripcion?: string
  precio_dia: number
  imagen?: string
  categoria?: { id: number; nombre: string }
  tipo?: { id: number; nombre: string }
  marca?: { id: number; nombre: string }
  condicion?: string
  estado?: string
}

type Coupon = { id?: number; codigo: string; descuento: number }
type Option = { id: number; nombre: string }

export default function AdminDashboard() {
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [p, setP] = useState<Equipo>({ modelo: '', precio_dia: 0 })
  const [c, setC] = useState<Coupon>({ codigo: '', descuento: 0 })
  const [metrics, setMetrics] = useState<{ products: number; orders: number; revenue: number } | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [categories, setCategories] = useState<Option[]>([])
  const [tipos, setTipos] = useState<Option[]>([])
  const [marcas, setMarcas] = useState<Option[]>([])

  useEffect(() => {
    api.get<Equipo[]>('/equipos/').then(r => {
      const normalized = (r.data || []).map(x => ({ ...x, precio_dia: Number(x.precio_dia) }))
      setEquipos(normalized)
    })
    api.get<Coupon[]>('/cupones/').then(r => setCoupons(r.data))
    api.get('/dashboard/metricas/').then(r => {
      const m = r.data || { products: 0, orders: 0, revenue: 0 }
      setMetrics({ products: Number(m.products) || 0, orders: Number(m.orders) || 0, revenue: Number(m.revenue) || 0 })
    })
    api.get<Option[]>('/categorias/').then(r => setCategories(r.data))
    api.get<Option[]>('/tipos/').then(r => setTipos(r.data))
    api.get<Option[]>('/marcas/').then(r => setMarcas(r.data))
  }, [])

  function saveEquipo() {
    const method = p.id ? 'put' : 'post'
    const url = p.id ? `/equipos/${p.id}/` : `/equipos/`
    const fd = new FormData()
    fd.append('modelo', p.modelo)
    fd.append('precio_dia', String(p.precio_dia))
    if (p.categoria?.id) fd.append('categoria', String(p.categoria.id))
    if (p.tipo?.id) fd.append('tipo', String(p.tipo.id))
    if (p.marca?.id) fd.append('marca', String(p.marca.id))
    if (p.condicion) fd.append('condicion', p.condicion)
    if (p.descripcion) fd.append('descripcion', p.descripcion)
    if (imageFile) fd.append('imagen', imageFile)
    
    api({ method, url, data: fd })
      .then(() => {
        setImageFile(null)
        api.get<Equipo[]>('/equipos/').then(r => {
          const normalized = (r.data || []).map(x => ({ ...x, precio_dia: Number(x.precio_dia) }))
          setEquipos(normalized)
        })
        setP({ modelo: '', precio_dia: 0 })
      })
      .catch(() => {})
  }

  function deleteEquipo(id?: number) {
    if (!id) return
    api.delete(`/equipos/${id}/`)
      .then(() => api.get<Equipo[]>('/equipos/').then(r => {
        const normalized = (r.data || []).map(x => ({ ...x, precio_dia: Number(x.precio_dia) }))
        setEquipos(normalized)
      }))
      .catch(() => {})
  }

  function saveCoupon() {
    const method = c.id ? 'put' : 'post'
    const url = c.id ? `/cupones/${c.id}/` : `/cupones/`
    const data = { codigo: (c.codigo || '').trim(), descuento: Math.max(0, Math.min(1, Number(c.descuento) || 0)) }
    api({ method, url, data })
      .then(() => {
        api.get<Coupon[]>('/cupones/').then(r => setCoupons(r.data))
        setC({ codigo: '', descuento: 0 })
      })
      .catch(() => {})
  }

  function deleteCoupon(id?: number) {
    if (!id) return
    api.delete(`/cupones/${id}/`)
      .then(() => api.get<Coupon[]>('/cupones/').then(r => setCoupons(r.data)))
      .catch(() => {})
  }

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-xl border p-6 bg-gradient-to-br from-blue-50 to-white">
          <p className="text-sm text-gray-600">Equipos</p>
          <p className="mt-2 text-3xl font-bold">{metrics?.products ?? 0}</p>
        </div>
        <div className="rounded-xl border p-6 bg-gradient-to-br from-violet-50 to-white">
          <p className="text-sm text-gray-600">Órdenes</p>
          <p className="mt-2 text-3xl font-bold">{metrics?.orders ?? 0}</p>
        </div>
        <div className="rounded-xl border p-6 bg-gradient-to-br from-emerald-50 to-white">
          <p className="text-sm text-gray-600">Ingresos</p>
          <p className="mt-2 text-3xl font-bold">${(metrics?.revenue ?? 0).toFixed(2)}</p>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-8">
        <section>
          <h2 className="text-xl font-semibold">Equipos</h2>
          <div className="mt-4 space-y-3">
            <input 
              className="border rounded px-3 py-2 w-full" 
              placeholder="Modelo" 
              value={p.modelo} 
              onChange={e => setP({ ...p, modelo: e.target.value })} 
            />
            <input 
              className="border rounded px-3 py-2 w-full" 
              type="number" 
              placeholder="Precio / Día" 
              value={p.precio_dia || ''} 
              onChange={e => setP({ ...p, precio_dia: Number(e.target.value) })} 
            />
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select 
                className="border rounded px-3 py-2 w-full" 
                value={p.categoria?.id || ''} 
                onChange={e => {
                  const id = Number(e.target.value)
                  setP({ ...p, categoria: { id, nombre: categories.find(x => x.id === id)?.nombre || '' } })
                }}
              >
                <option value="">Categoría</option>
                {categories.map(opt => <option key={opt.id} value={opt.id}>{opt.nombre}</option>)}
              </select>

              <select 
                className="border rounded px-3 py-2 w-full" 
                value={p.tipo?.id || ''} 
                onChange={e => {
                  const id = Number(e.target.value)
                  setP({ ...p, tipo: { id, nombre: tipos.find(x => x.id === id)?.nombre || '' } })
                }}
              >
                <option value="">Tipo</option>
                {tipos.map(opt => <option key={opt.id} value={opt.id}>{opt.nombre}</option>)}
              </select>

              <select 
                className="border rounded px-3 py-2 w-full" 
                value={p.marca?.id || ''} 
                onChange={e => {
                  const id = Number(e.target.value)
                  setP({ ...p, marca: { id, nombre: marcas.find(x => x.id === id)?.nombre || '' } })
                }}
              >
                <option value="">Marca</option>
                {marcas.map(opt => <option key={opt.id} value={opt.id}>{opt.nombre}</option>)}
              </select>
            </div>

            <select 
              className="border rounded px-3 py-2 w-full" 
              value={p.condicion || ''} 
              onChange={e => setP({ ...p, condicion: e.target.value })}
            >
              <option value="">Condición</option>
              <option value="nueva">Nuevo</option>
              <option value="seminueva">Seminuevo</option>
            </select>

            <input 
              type="file" 
              accept="image/*" 
              className="border rounded px-3 py-2 w-full" 
              onChange={e => setImageFile(e.target.files?.[0] || null)} 
            />
            
            <textarea 
              className="border rounded px-3 py-2 w-full" 
              placeholder="Descripción" 
              value={p.descripcion || ''} 
              onChange={e => setP({ ...p, descripcion: e.target.value })} 
            />
            
            <button 
              className="px-4 py-2 rounded bg-blue-600 text-white" 
              onClick={saveEquipo}
            >
              Guardar
            </button>
          </div>

          <ul className="mt-6 space-y-2">
            {equipos.map(pr => (
              <li key={pr.id} className="flex items-center justify-between border rounded p-3">
                <div>
                  <p className="font-medium">{pr.modelo}</p>
                  <p className="text-sm text-gray-600">
                    ${Number(pr.precio_dia).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / día • {pr.categoria?.nombre || '—'} / {pr.tipo?.nombre || '—'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button className="px-3 py-1 rounded border" onClick={() => setP(pr)}>Editar</button>
                  <button className="px-3 py-1 rounded border" onClick={() => deleteEquipo(pr.id)}>Eliminar</button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Cupones</h2>
          <div className="mt-4 space-y-3">
            <input 
              className="border rounded px-3 py-2 w-full" 
              placeholder="Código" 
              value={c.codigo} 
              onChange={e => setC({ ...c, codigo: e.target.value })} 
            />
            <input
              className="border rounded px-3 py-2 w-full"
              type="number"
              placeholder="Descuento (%)"
              min={0}
              max={100}
              step={1}
              value={Number.isFinite(c.descuento) ? Math.round((c.descuento || 0) * 100) : 0}
              onChange={e => {
                const percent = Math.max(0, Math.min(100, Number(e.target.value) || 0))
                setC({ ...c, descuento: percent / 100 })
              }}
            />
            <button className="px-4 py-2 rounded bg-blue-600 text-white" onClick={saveCoupon}>Guardar</button>
          </div>
          <ul className="mt-6 space-y-2">
            {coupons.map(cp => (
              <li key={cp.id} className="flex items-center justify-between border rounded p-3">
                <div>
                  <p className="font-medium">{cp.codigo}</p>
                  <p className="text-sm text-gray-600">{(cp.descuento * 100).toFixed(0)}%</p>
                </div>
                <div className="flex items-center gap-3">
                  <button className="px-3 py-1 rounded border" onClick={() => setC(cp)}>Editar</button>
                  <button className="px-3 py-1 rounded border" onClick={() => deleteCoupon(cp.id)}>Eliminar</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}