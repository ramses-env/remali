import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Home from './routes/Home'
import EquiposList from './routes/EquiposList'
import Favoritos from './routes/Favoritos'
import EquipoDetail from './routes/EquipoDetail'
import Cotizacion from './routes/Cotizacion'
import Login from './routes/Login'
import Registro from './routes/Registro'
import Recuperar from './routes/Recuperar'
import Restablecer from './routes/Restablecer'
import Perfil from './routes/Perfil'
import MisCotizaciones from './routes/MisCotizaciones'
import MisCotizacionEstado from './routes/MisCotizacionEstado'
import MisRentas from './routes/MisRentas'
import MisAdeudos from './routes/MisAdeudos'
import RecordatorioAdeudo from './components/RecordatorioAdeudo'
import MisCompras from './routes/MisCompras'
import MisReparaciones from './routes/MisReparaciones'
import SeguirReparacion from './routes/SeguirReparacion'
import VincularCuenta from './routes/VincularCuenta'
import AutorizarCotizacion from './routes/AutorizarCotizacion'
import AutorizarLote from './routes/AutorizarLote'
import UnidadQR from './routes/UnidadQR'
import RecordatorioPerfil from './components/RecordatorioPerfil'
import CambioTipoCotizacion from './components/CambioTipoCotizacion'
import DockTienda from './components/DockTienda'
import OnboardingTour from './components/onboarding/OnboardingTour'
import TODOS_TOURS from './components/onboarding/tours'
import { AuthSplitScreen } from '@/components/ui/auth-split-screen'
import Footer from './components/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import ErrorPage from './routes/ErrorPage'
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
    location.pathname === '/registro' ||
    location.pathname === '/recuperar' ||
    location.pathname.startsWith('/restablecer')

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
              <Route path="/recuperar" element={<Recuperar />} />
              <Route path="/restablecer/:uid/:token" element={<Restablecer />} />
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
            className="min-h-screen flex flex-col bg-app text-ink pb-24 md:pb-0"
            style={{ ['--c-gold' as any]: '#FFC61A', ['--c-gold-soft' as any]: 'rgba(255,198,26,0.14)' }}
          >
            <Navbar />
            <div className="flex-1 w-full">
              <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/equipos" element={<EquiposList />} />
                  <Route path="/favoritos" element={<Favoritos />} />
                  <Route path="/equipo/:id" element={<EquipoDetail />} />
                  <Route path="/cotizacion" element={<Cotizacion />} />
                  {/* El perfil del cliente vive en la tienda, con su navbar y su
                      footer: es su casa, no una sección del panel de operación. */}
                  <Route path="/perfil" element={<Perfil />} />
                  <Route path="/mis-cotizaciones" element={<MisCotizaciones />} />
                  <Route path="/mis-cotizaciones/:folio" element={<MisCotizacionEstado />} />
                  <Route path="/mis-rentas" element={<MisRentas />} />
                  <Route path="/mis-adeudos" element={<MisAdeudos />} />
                  <Route path="/mis-compras" element={<MisCompras />} />
                  <Route path="/mis-reparaciones" element={<MisReparaciones />} />
                  <Route path="/mis-reparaciones/:folio" element={<SeguirReparacion modo="cuenta" />} />
                  <Route path="/vincular/venta/:token" element={<VincularCuenta tipo="venta" />} />
                  <Route path="/vincular/renta/:token" element={<VincularCuenta tipo="renta" />} />
                  <Route path="/vincular/cotizacion/:token" element={<VincularCuenta tipo="cotizacion" />} />
                  <Route path="/vincular/reparacion/:token" element={<VincularCuenta tipo="reparacion" />} />
                  <Route path="/seguir/reparacion/:token" element={<SeguirReparacion modo="publico" />} />
                  {/* Liga del JEFE: pública, sin cuenta; autorizar la manda a REMALI */}
                  <Route path="/autorizar/:token" element={<AutorizarCotizacion />} />
                  {/* Liga del JEFE para un LOTE: autoriza/rechaza varias juntas */}
                  <Route path="/autorizar-lote/:token" element={<AutorizarLote />} />
                  {/* La página del QR pegado en cada máquina */}
                  <Route path="/u/:codigo" element={<UnidadQR />} />
                  <Route path="*" element={<ErrorPage type="404" />} />
                </Routes>
              </ErrorBoundary>
            </div>
            <Footer />
            {/* Recordatorios flotantes del cliente (perfil a medias, adeudo):
                apilados en un contenedor para que NO se enciman si salen juntos.
                El contenedor no bloquea clics; cada alerta sí es interactiva. */}
            <div className="fixed top-[76px] left-4 right-4 z-40 md:left-auto md:right-5 md:max-w-[360px] flex flex-col gap-3 pointer-events-none">
              <RecordatorioPerfil />
              <RecordatorioAdeudo />
            </div>
            {/* Pregunta al intentar mezclar venta y renta en una cotización. */}
            <CambioTipoCotizacion />
            {/* Tour guiado de primer uso (solo corre si el cliente es nuevo y no lo completó ya). */}
            <OnboardingTour tours={TODOS_TOURS} />
            {/* Dock inferior (solo móvil): navegación al alcance del pulgar. */}
            <DockTienda />
          </div>
        </PriceUnitProvider>
      )}
    </I18nProvider>
  )
}

export default App
