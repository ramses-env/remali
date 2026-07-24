import { Route, Routes, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Home from './routes/Home'
import EquiposList from './routes/EquiposList'
import EquipoDetail from './routes/EquipoDetail'
import Cotizacion from './routes/Cotizacion'
import Login from './routes/Login'
import Registro from './routes/Registro'
import Perfil from './routes/Perfil'
import RecordatorioPerfil from './components/RecordatorioPerfil'
import DockTienda from './components/DockTienda'
import { AuthSplitScreen } from '@/components/ui/auth-split-screen'
import Dashboard from './routes/Dashboard'
import Footer from './components/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import RequireAdmin from './components/RequireAdmin'
import CargaGlobal from './components/CargaGlobal'
import { PriceUnitProvider } from './store/priceUnit'
import { I18nProvider } from './lib/i18n'

function App() {
  const location = useLocation()
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
            <Route path="/dashboard" element={<RequireAdmin><Dashboard /></RequireAdmin>} />
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
                  <Route path="*" element={<Home />} />
                </Routes>
              </ErrorBoundary>
            </div>
            <Footer />
            {/* Recordatorio flotante para clientes con el perfil a medias. Vive
                aquí, no en cada página, para aparecer en toda la tienda. */}
            <RecordatorioPerfil />
            {/* Dock inferior (solo móvil): navegación al alcance del pulgar. */}
            <DockTienda />
          </div>
        </PriceUnitProvider>
      )}
    </I18nProvider>
  )
}

export default App
