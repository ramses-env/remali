import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import Carousel from '../components/Carousel'

export default function Home() {
  return (
    <div className="space-y-20">
      <section className="relative overflow-hidden rounded-3xl border bg-white">
        <div className="absolute -top-20 -left-32 h-72 w-72 rounded-full bg-neutral-200/30 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-neutral-200/30 blur-3xl" />
        <div className="p-8 md:p-12 grid md:grid-cols-2 gap-10 items-center">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1 text-xs text-neutral-700">
              <span className="h-2 w-2 rounded-full bg-neutral-800" />
              <span>Lanzamiento 2026 • Alquiler y venta</span>
            </div>
            <h1 className="mt-4 text-4xl md:text-6xl font-extrabold tracking-tight text-neutral-900">
              Equipos de construcción de alto desempeño
            </h1>
            <p className="mt-4 text-base md:text-lg text-neutral-700">
              Compactadores, cortadoras y demoledores listos para obra. Atención rápida y soporte experto.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link to="/equipos" className="px-6 py-3 rounded-full bg-black text-white shadow hover:shadow-md">
                Ver catálogo
              </Link>
              <Link to="/cotizacion" className="px-6 py-3 rounded-full border bg-white hover:bg-neutral-100">
                Solicitar cotización
              </Link>
            </div>
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div className="flex items-center gap-3 rounded-2xl border bg-white p-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-neutral-800"><path d="M4 17V7a2 2 0 0 1 2-2h6l2 2h6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" stroke="currentColor" strokeWidth="1.5"/></svg>
                <span>Entrega el mismo día*</span>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border bg-white p-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-neutral-800"><path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-7Z" stroke="currentColor" strokeWidth="1.5"/></svg>
                <span>Garantía y mantenimiento</span>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border bg-white p-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-neutral-800"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.418 0-8 2.239-8 5v1h16v-1c0-2.761-3.582-5-8-5Z" stroke="currentColor" strokeWidth="1.5"/></svg>
                <span>Soporte técnico</span>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-4 text-center">
              <div className="rounded-2xl border bg-white p-4">
                <p className="text-2xl font-extrabold">+150</p>
                <p className="text-xs text-neutral-600">Proyectos</p>
              </div>
              <div className="rounded-2xl border bg-white p-4">
                <p className="text-2xl font-extrabold">24h</p>
                <p className="text-xs text-neutral-600">Respuesta</p>
              </div>
              <div className="rounded-2xl border bg-white p-4">
                <p className="text-2xl font-extrabold">+30</p>
                <p className="text-xs text-neutral-600">Equipos</p>
              </div>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6 }}>
            <Carousel
              className="bg-neutral-50"
              items={[
                { image: '/images/compactador_hyundai.jpg', title: 'Compactador HYUNDAI', subtitle: 'Potencia y estabilidad para suelos' , ctaText: 'Ver compactadores', ctaLink: '/equipos' },
                { image: '/images/compactador_2.jpeg', title: 'Cortadora de piso', subtitle: 'Cortes limpios y precisos' },
                { image: '/images/revolvedora.jpeg', title: 'Pontente' },
              ]}
              autoPlayMs={5000}
              showDots
            />
          </motion.div>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-2xl font-extrabold text-neutral-900">Colecciones destacadas</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <Link to="/equipos" className="group rounded-2xl border bg-white p-6 hover:shadow-md">
            <p className="font-bold group-hover:text-neutral-900">Concreto</p>
            <p className="text-sm text-gray-600">Mezcladoras, vibradores, cortadoras</p>
          </Link>
          <Link to="/equipos" className="group rounded-2xl border bg-white p-6 hover:shadow-md">
            <p className="font-bold group-hover:text-neutral-900">Construcción</p>
            <p className="text-sm text-gray-600">Herramientas y equipos confiables</p>
          </Link>
          <Link to="/equipos" className="group rounded-2xl border bg-white p-6 hover:shadow-md">
            <p className="font-bold group-hover:text-neutral-900">Ofertas</p>
            <p className="text-sm text-gray-600">Descuentos y combos</p>
          </Link>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-2xl font-extrabold text-neutral-900">Por qué elegirnos</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="rounded-2xl border bg-white p-6">
            <p className="font-bold">Experiencia</p>
            <p className="text-sm text-gray-600">Años atendiendo proyectos exigentes.</p>
          </div>
          <div className="rounded-2xl border bg-white p-6">
            <p className="font-bold">Procesos modernos</p>
            <p className="text-sm text-gray-600">Compra y seguimiento transparente.</p>
          </div>
          <div className="rounded-2xl border bg-white p-6">
            <p className="font-bold">Soporte dedicado</p>
            <p className="text-sm text-gray-600">Acompañamiento técnico especializado.</p>
          </div>
          <div className="rounded-2xl border bg-white p-6">
            <p className="font-bold">Calidad garantizada</p>
            <p className="text-sm text-gray-600">Equipos probados y certificados.</p>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-2xl font-extrabold text-neutral-900">Equipos en acción</h2>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <Carousel
            items={[
              { image: '/images/inicio-compactador-2.jpg', title: 'Obra urbana', subtitle: 'Compactación eficiente en campo' },
              { image: '/images/compactadoras.jpeg', title: 'Taller y mantenimiento', subtitle: 'Corte de pavimento y concreto' },
              { image: '/images/inicio-compactador-3.jpg', title: 'Construcción residencial', subtitle: 'Equipos confiables y potentes' },
            ]}
            autoPlayMs={4500}
            showDots
          />
        </motion.div>
      </section>
    </div>
  )
}
