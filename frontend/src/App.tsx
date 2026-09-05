import { lazy, Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import BarraAviso from './components/BarraAviso'
import Home from './routes/Home'
import CambioTipoCotizacion from './components/CambioTipoCotizacion'
import DockTienda from './components/DockTienda'
import OnboardingGate from './components/onboarding/OnboardingGate'
import ScrollAlTope from './components/ScrollAlTope'
import Footer from './components/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import ErrorPage from './routes/ErrorPage'
import RequireAdmin from './components/RequireAdmin'
import CargaGlobal from './components/CargaGlobal'
import { PriceUnitProvider } from './store/priceUnit'
import { I18nProvider } from './lib/i18n'

// Cada ruta viaja en su propio archivo. Antes se importaban las 23 de forma
// estática y el chunk de entrada pesaba 1.11 MB: quien abría la tienda para ver
// una máquina descargaba también el perfil, las cotizaciones, las reparaciones y
// el generador de PDF. Con lazy() cada quien baja lo que abre.
const EquiposList = lazy(() => import('./routes/EquiposList'))
const Favoritos = lazy(() => import('./routes/Favoritos'))
const EquipoDetail = lazy(() => import('./routes/EquipoDetail'))
const Cotizacion = lazy(() => import('./routes/Cotizacion'))
const Login = lazy(() => import('./routes/Login'))
const Registro = lazy(() => import('./routes/Registro'))
/* Estos tres traen framer-motion. Estáticos, metían esa librería (123 KB) en la
   primera carga de TODA la tienda: los recordatorios solo aparecen si el cliente
   tiene el perfil a medias o un adeudo, y la pantalla partida solo en /login y
   /registro. Ninguno pinta nada en el primer render. */
const RecordatorioAdeudo = lazy(() => import('./components/RecordatorioAdeudo'))
const RecordatorioPerfil = lazy(() => import('./components/RecordatorioPerfil'))
const AuthSplitScreen = lazy(() => import('@/components/ui/auth-split-screen').then(m => ({ default: m.AuthSplitScreen })))
const Recuperar = lazy(() => import('./routes/Recuperar'))
const Restablecer = lazy(() => import('./routes/Restablecer'))
const VerificarCorreo = lazy(() => import('./routes/VerificarCorreo'))
const Perfil = lazy(() => import('./routes/Perfil'))
const MisCotizaciones = lazy(() => import('./routes/MisCotizaciones'))
const MisCotizacionEstado = lazy(() => import('./routes/MisCotizacionEstado'))
const MisRentas = lazy(() => import('./routes/MisRentas'))
const MisAdeudos = lazy(() => import('./routes/MisAdeudos'))
const MisCompras = lazy(() => import('./routes/MisCompras'))
const MisReparaciones = lazy(() => import('./routes/MisReparaciones'))
const SeguirReparacion = lazy(() => import('./routes/SeguirReparacion'))
const VincularCuenta = lazy(() => import('./routes/VincularCuenta'))
const AutorizarCotizacion = lazy(() => import('./routes/AutorizarCotizacion'))
const RescatarEspacio = lazy(() => import('./routes/RescatarEspacio'))
const UnidadQR = lazy(() => import('./routes/UnidadQR'))
// El panel admin pesa más que toda la tienda junta; se descarga solo cuando
// alguien entra a /dashboard, no en la primera visita de cada cliente.
const Dashboard = lazy(() => import('./routes/Dashboard'))

/* Lo que se ve el instante que tarda en bajar el archivo de una ruta. Es el mismo
   spinner del panel: si parpadea algo distinto en cada sección, se siente rota. */
function CargandoRuta() {
  return (
    <div className="min-h-[60vh] grid place-items-center">
      <div className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" role="status" aria-label="Cargando" />
    </div>
  )
}

function App() {
  const location = useLocation()
  // Rutas que NO usan el chrome público (navbar + footer)
  const bare =
    location.pathname.startsWith('/dashboard') ||
    location.pathname === '/login' ||
    location.pathname === '/registro' ||
    location.pathname === '/recuperar' ||
    location.pathname.startsWith('/restablecer') ||
    location.pathname.startsWith('/verificar')

  return (
    <I18nProvider>
      <ScrollAlTope />
      <CargaGlobal />
      {bare ? (
        <ErrorBoundary>
          <Suspense fallback={<CargandoRuta />}>
          <Routes>
            {/* Ruta de layout: el marco (foto, logo, botones) se monta una sola
                vez y solo cambia el contenido, que es lo que permite animar el
                paso de login a registro sin que parezca otra ventana. */}
            <Route element={<AuthSplitScreen />}>
              <Route path="/login" element={<Login />} />
              <Route path="/registro" element={<Registro />} />
              <Route path="/recuperar" element={<Recuperar />} />
              <Route path="/restablecer/:uid/:token" element={<Restablecer />} />
              {/* Sin token: el código se teclea. La liga se retiró porque los
                  escáneres de correo la abrían solos y quemaban el token. */}
              <Route path="/verificar" element={<VerificarCorreo />} />
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
          </Suspense>
        </ErrorBoundary>
      ) : (
        <PriceUnitProvider>
          {/* La tienda pública usa el amarillo brillante del sistema (no el dorado del admin).
              Se sobreescribe el token solo aquí, así el panel admin queda intacto. */}
          <div
            /* pb en móvil: reserva el alto del dock flotante para que no tape el
               final del contenido. En md+ el dock no existe, así que sin padding. */
            /* `tienda` no pinta nada: es la marca que el CSS usa para saber que
               este recorrido es el de los clientes y no el panel. De ella cuelga
               el cursor propio (index.css, `body:has(.tienda)`). */
            className="tienda min-h-screen flex flex-col bg-app text-ink pb-24 md:pb-0"
            /* `paddingTop` sigue al alto de la barra de aviso: sin ella la
               variable no existe y vale 0, así que la tienda queda exactamente
               como estaba. Con ella, todo baja lo justo y el menú (que es fijo)
               no acaba tapando el primer bloque de cada página. */
            style={{
              ['--c-gold' as any]: '#FFC61A',
              ['--c-gold-soft' as any]: 'rgba(255,198,26,0.14)',
              paddingTop: 'var(--alto-aviso, 0px)',
            }}
          >
            {/* Arriba del todo, incluso de la navegación: un aviso de temporada
                que aparece debajo del menú no se lee como aviso del sitio. */}
            <BarraAviso />
            <Navbar />
            <div className="flex-1 w-full">
              <ErrorBoundary>
                <Suspense fallback={<CargandoRuta />}>
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
                  {/* Liga de QUIEN AUTORIZA: pública, sin cuenta. Sirve igual
                      para una cotización que para varias. */}
                  <Route path="/autorizar/:token" element={<AutorizarCotizacion />} />
                  {/* Recuperar el taller de un cliente SIN cuenta en otro equipo */}
                  <Route path="/mis-borradores/:token" element={<RescatarEspacio />} />
                  {/* Liga del JEFE para un LOTE: autoriza/rechaza varias juntas */}
                  {/* La página del QR pegado en cada máquina */}
                  <Route path="/u/:codigo" element={<UnidadQR />} />
                  <Route path="*" element={<ErrorPage type="404" />} />
                </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
            <Footer />
            {/* Recordatorios flotantes del cliente (perfil a medias, adeudo):
                apilados en un contenedor para que NO se enciman si salen juntos.
                El contenedor no bloquea clics; cada alerta sí es interactiva. */}
            {/* El tope sale de --nav-h (lo publica el Navbar, que encoge al hacer
                scroll): así el aviso siempre queda DEBAJO de la barra y no
                tapado por ella, que va con z-50. */}
            <div
              style={{ top: 'calc(var(--nav-h, 80px) + 12px)' }}
              className="fixed left-4 right-4 z-40 md:left-auto md:right-5 md:max-w-[360px] flex flex-col gap-3 pointer-events-none transition-[top] duration-300"
            >
              <Suspense fallback={null}>
                <RecordatorioPerfil />
                <RecordatorioAdeudo />
              </Suspense>
            </div>
            {/* Pregunta al intentar mezclar venta y renta en una cotización. */}
            <CambioTipoCotizacion />
            {/* Tour guiado de primer uso (solo corre si el cliente es nuevo y no lo completó ya).
                El portero decide eso SIN bajar react-joyride; la librería llega
                solo si de verdad hay guía que correr. */}
            <OnboardingGate />
            {/* Dock inferior (solo móvil): navegación al alcance del pulgar. */}
            <DockTienda />
          </div>
        </PriceUnitProvider>
      )}
    </I18nProvider>
  )
}

export default App
