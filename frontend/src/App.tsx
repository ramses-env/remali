import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Home from './routes/Home'
import EquiposList from './routes/EquiposList'
import EquipoDetail from './routes/EquipoDetail'
import Cotizacion from './routes/Cotizacion'
import Login from './routes/Login'
import Registro from './routes/Registro'
import Perfil from './routes/Perfil'
import MisCotizaciones from './routes/MisCotizaciones'
import MisCotizacionEstado from './routes/MisCotizacionEstado'
import MisRentas from './routes/MisRentas'
import VincularCuenta from './routes/VincularCuenta'
import RecordatorioPerfil from './components/RecordatorioPerfil'
import CambioTipoCotizacion from './components/CambioTipoCotizacion'
import DockTienda from './components/DockTienda'
import { AuthSplitScreen } from '@/components/ui/auth-split-screen'
import Footer from './components/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import RequireAdmin from './components/RequireAdmin'
import CargaGlobal from './components/CargaGlobal'
import { PriceUnitProvider } from './store/priceUnit'
import { I18nProvider } from './lib/i18n'

// El panel admin pesa más que toda la tienda junta; se descarga solo cuando
// alguien entra a /dashboard, no en la primera visita de cada cliente.
const Dashboard = lazy(() => import('./routes/Dashboard'))

function App() {
  const location = useLocation()
  // Al cambiar de ruta, vuelve al inicio del scroll. Sin esto la SPA conserva la
  // posición de la página anterior y la nueva abre "a media página".
  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])
  // Rutas que NO usan el chrome público (navbar + footer)
  const bare =
    location.pathname.startsWith('/dashboard') ||
    location.pathname === '/login' ||
    location.pathname === '/registro'

  return (
    <I18nProvider>
      <CargaGlobal />
      {bare ? (
        <ErrorBoundary>
          <Routes>
            {/* Ruta de layout: el marco (foto, logo, botones) se monta una sola
                vez y solo cambia el contenido, que es lo que permite animar el
                paso de login a registro sin que parezca otra ventana. */}
            <Route element={<AuthSplitScreen />}>
              <Route path="/login" element={<Login />} />
              <Route path="/registro" element={<Registro />} />
            </Route>
            {/* /dashboard/* : cualquier subruta (bookmark viejo, refresh) cae al
                panel en vez de renderizar una página en blanco. */}
            <Route
              path="/dashboard/*"
              element={
                <RequireAdmin>
                  <Suspense fallback={<div className="min-h-screen grid place-items-center bg-app"><div className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" aria-label="Cargando panel" /></div>}>
                    <Dashboard />
                  </Suspense>
                </RequireAdmin>
              }
            />
          </Routes>
        </ErrorBoundary>
      ) : (
        <PriceUnitProvider>
          {/* La tienda pública usa el amarillo brillante del sistema (no el dorado del admin).
              Se sobreescribe el token solo aquí, así el panel admin queda intacto. */}
          <div
            /* pb en móvil: reserva el alto del dock flotante para que no tape el
               final del contenido. En md+ el dock no existe, así que sin padding. */
            className="min-h-screen flex flex-col bg-[#080808] text-white pb-24 md:pb-0"
            style={{ ['--c-gold' as any]: '#f2b736', ['--c-gold-soft' as any]: 'rgba(242,183,54,0.14)' }}
          >
            <Navbar />
            <div className="flex-1 w-full">
              <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/equipos" element={<EquiposList />} />
                  <Route path="/equipo/:id" element={<EquipoDetail />} />
                  <Route path="/cotizacion" element={<Cotizacion />} />
                  {/* El perfil del cliente vive en la tienda, con su navbar y su
                      footer: es su casa, no una sección del panel de operación. */}
                  <Route path="/perfil" element={<Perfil />} />
                  <Route path="/mis-cotizaciones" element={<MisCotizaciones />} />
                  <Route path="/mis-cotizaciones/:folio" element={<MisCotizacionEstado />} />
                  <Route path="/mis-rentas" element={<MisRentas />} />
                  <Route path="/vincular/venta/:token" element={<VincularCuenta tipo="venta" />} />
                  <Route path="/vincular/renta/:token" element={<VincularCuenta tipo="renta" />} />
                  <Route path="*" element={<Home />} />
                </Routes>
              </ErrorBoundary>
            </div>
            <Footer />
            {/* Recordatorio flotante para clientes con el perfil a medias. Vive
                aquí, no en cada página, para aparecer en toda la tienda. */}
            <RecordatorioPerfil />
            {/* Pregunta al intentar mezclar venta y renta en una cotización. */}
            <CambioTipoCotizacion />
            {/* Dock inferior (solo móvil): navegación al alcance del pulgar. */}
            <DockTienda />
          </div>
        </PriceUnitProvider>
      )}
    </I18nProvider>
  )
}

export default App
