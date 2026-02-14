import api from '../lib/api'
import { useEffect, useState } from 'react'

type Product = { id?: number; title: string; price: number; image?: string; description?: string; stock?: number; category?: { id: number; name: string }; equipo?: { id: number; name: string }; marca?: { id: number; name: string }; condition?: string }
type Coupon = { id?: number; code: string; discount: number }
type Option = { id: number; name: string }

export default function AdminDashboard() {
  const [products, setProducts] = useState<Product[]>([])
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [p, setP] = useState<Product>({ title: '', price: 0, stock: 0 })
  const [c, setC] = useState<Coupon>({ code: '', discount: 0 })
  const [metrics, setMetrics] = useState<{ products: number; orders: number; revenue: number } | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [categories, setCategories] = useState<Option[]>([])
  const [equipos, setEquipos] = useState<Option[]>([])
  const [marcas, setMarcas] = useState<Option[]>([])

  useEffect(() => {
    api.get<Product[]>('/products/').then(r => {
      const normalized = (r.data || []).map(x => ({ ...x, price: Number(x.price) }))
      setProducts(normalized)
    })
    api.get<Coupon[]>('/coupons/').then(r => setCoupons(r.data))
    api.get('/dashboard/metrics/').then(r => {
      const m = r.data || { products: 0, orders: 0, revenue: 0 }
      setMetrics({ products: Number(m.products) || 0, orders: Number(m.orders) || 0, revenue: Number(m.revenue) || 0 })
    })
    api.get<Option[]>('/categories/').then(r => setCategories(r.data))
    api.get<Option[]>('/equipos/').then(r => setEquipos(r.data))
    api.get<Option[]>('/marcas/').then(r => setMarcas(r.data))
  }, [])

  function saveProduct() {
    const method = p.id ? 'put' : 'post'
    const url = p.id ? `/products/${p.id}/` : `/products/`
    const fd = new FormData()
    fd.append('title', p.title)
    fd.append('price', String(p.price))
    fd.append('stock', String(p.stock || 0))
    if (p.category?.id) fd.append('category', String(p.category.id))
    if (p.equipo?.id) fd.append('equipo', String(p.equipo.id))
    if (p.marca?.id) fd.append('marca', String(p.marca.id))
    if (p.condition) fd.append('condition', p.condition)
    if (p.description) fd.append('description', p.description)
    if (imageFile) fd.append('image', imageFile)
    api({ method, url, data: fd })
      .then(() => {
        setImageFile(null)
        api.get<Product[]>('/products/').then(r => {
          const normalized = (r.data || []).map(x => ({ ...x, price: Number(x.price) }))
          setProducts(normalized)
        })
      })
      .catch(() => {})
  }
  function deleteProduct(id?: number) {
    if (!id) return
    api.delete(`/products/${id}/`)
      .then(() => api.get<Product[]>('/products/').then(r => {
        const normalized = (r.data || []).map(x => ({ ...x, price: Number(x.price) }))
        setProducts(normalized)
      }))
      .catch(() => {})
  }
  function saveCoupon() {
    const method = c.id ? 'put' : 'post'
    const url = c.id ? `/coupons/${c.id}/` : `/coupons/`
    const data = { code: (c.code || '').trim(), discount: Math.max(0, Math.min(1, Number(c.discount) || 0)) }
    api({ method, url, data })
      .then(() => api.get<Coupon[]>('/coupons/').then(r => setCoupons(r.data)))
      .catch(() => {})
  }
  function deleteCoupon(id?: number) {
    if (!id) return
    api.delete(`/coupons/${id}/`)
      .then(() => api.get<Coupon[]>('/coupons/').then(r => setCoupons(r.data)))
      .catch(() => {})
  }

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-xl border p-6 bg-gradient-to-br from-blue-50 to-white">
          <p className="text-sm text-gray-600">Productos</p>
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
        <h2 className="text-xl font-semibold">Productos</h2>
        <div className="mt-4 space-y-3">
          <input className="border rounded px-3 py-2 w-full" placeholder="Nombre" value={p.title} onChange={e => setP({ ...p, title: e.target.value })} />
          <input className="border rounded px-3 py-2 w-full" type="number" placeholder="Precio" value={p.price} onChange={e => setP({ ...p, price: Number(e.target.value) })} />
          <input className="border rounded px-3 py-2 w-full" type="number" placeholder="Stock" value={p.stock || 0} onChange={e => setP({ ...p, stock: Number(e.target.value) })} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select className="border rounded px-3 py-2 w-full" value={p.category?.id || ''} onChange={e => setP({ ...p, category: { id: Number(e.target.value), name: categories.find(x => x.id === Number(e.target.value))?.name || '' } })}>
              <option value="">Categoría</option>
              {categories.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
            </select>
            <select className="border rounded px-3 py-2 w-full" value={p.equipo?.id || ''} onChange={e => setP({ ...p, equipo: { id: Number(e.target.value), name: equipos.find(x => x.id === Number(e.target.value))?.name || '' } })}>
              <option value="">Equipo</option>
              {equipos.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
            </select>
            <select className="border rounded px-3 py-2 w-full" value={p.marca?.id || ''} onChange={e => setP({ ...p, marca: { id: Number(e.target.value), name: marcas.find(x => x.id === Number(e.target.value))?.name || '' } })}>
              <option value="">Marca</option>
              {marcas.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
            </select>
          </div>
          <select className="border rounded px-3 py-2 w-full" value={p.condition || ''} onChange={e => setP({ ...p, condition: e.target.value })}>
            <option value="">Condición</option>
            <option value="new">Nuevo</option>
            <option value="refurbished">Renovado</option>
            <option value="used">Usado</option>
          </select>
          <input type="file" accept="image/*" className="border rounded px-3 py-2 w-full" onChange={e => setImageFile(e.target.files?.[0] || null)} />
          <textarea className="border rounded px-3 py-2 w-full" placeholder="Descripción" value={p.description || ''} onChange={e => setP({ ...p, description: e.target.value })} />
          <button className="px-4 py-2 rounded bg-blue-600 text-white" onClick={saveProduct}>Guardar</button>
        </div>
        <ul className="mt-6 space-y-2">
          {products.map(pr => (
            <li key={pr.id} className="flex items-center justify-between border rounded p-3">
              <div>
                <p className="font-medium">{pr.title}</p>
                <p className="text-sm text-gray-600">${Number(pr.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} • Stock: {pr.stock ?? 0} • {pr.category?.name || '—'} / {pr.equipo?.name || '—'}</p>
              </div>
              <div className="flex items-center gap-3">
                <button className="px-3 py-1 rounded border" onClick={() => setP(pr)}>Editar</button>
                <button className="px-3 py-1 rounded border" onClick={() => deleteProduct(pr.id)}>Eliminar</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-xl font-semibold">Cupones</h2>
        <div className="mt-4 space-y-3">
          <input className="border rounded px-3 py-2 w-full" placeholder="Código" value={c.code} onChange={e => setC({ ...c, code: e.target.value })} />
          <input
            className="border rounded px-3 py-2 w-full"
            type="number"
            placeholder="Descuento (%)"
            min={0}
            max={100}
            step={1}
            value={Number.isFinite(c.discount) ? Math.round((c.discount || 0) * 100) : 0}
            onChange={e => {
              const percent = Math.max(0, Math.min(100, Number(e.target.value) || 0))
              setC({ ...c, discount: percent / 100 })
            }}
          />
          <button className="px-4 py-2 rounded bg-blue-600 text-white" onClick={saveCoupon}>Guardar</button>
        </div>
        <ul className="mt-6 space-y-2">
          {coupons.map(cp => (
            <li key={cp.id} className="flex items-center justify-between border rounded p-3">
              <div>
                <p className="font-medium">{cp.code}</p>
                <p className="text-sm text-gray-600">{(cp.discount * 100).toFixed(0)}%</p>
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
