import { Route, Routes, useLocation } from 'react-router-dom'
import CuentaRegresiva, { bypassEstreno } from './components/CuentaRegresiva'
import Navbar from './components/Navbar'
import Home from './routes/Home'
import EquiposList from './routes/EquiposList'
import EquipoDetail from './routes/EquipoDetail'
import Cotizacion from './routes/Cotizacion'
import Login from './routes/Login'
import Registro from './routes/Registro'
import Dashboard from './routes/Dashboard'
import Footer from './components/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import RequireAdmin from './components/RequireAdmin'
import RouteLoader from './components/RouteLoader'
import { PriceUnitProvider } from './store/priceUnit'
import { I18nProvider } from './lib/i18n'

function App() {
  const location = useLocation()
  // Rutas que NO usan el chrome público (navbar + footer)
  const bare =
    location.pathname.startsWith('/dashboard') ||
    location.pathname === '/login' ||
    location.pathname === '/registro'

  /* Estreno: en producción los visitantes SOLO ven la cuenta regresiva — el
     sitio no se destapa solo; se libera con el deploy de la versión nueva.
     Login/registro/dashboard quedan libres para el equipo, y /?acceso=remali
     deja previsualizar la web actual. */
  const espera = !bypassEstreno()

  return (
    <I18nProvider>
      <RouteLoader />
      {bare ? (
        <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/dashboard" element={<RequireAdmin><Dashboard /></RequireAdmin>} />
          </Routes>
        </ErrorBoundary>
      ) : espera ? (
        <CuentaRegresiva />
      ) : (
        <PriceUnitProvider>
          {/* La tienda pública usa el amarillo brillante del sistema (no el dorado del admin).
              Se sobreescribe el token solo aquí, así el panel admin queda intacto. */}
          <div
            className="min-h-screen flex flex-col bg-[#080808] text-white"
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
                  <Route path="*" element={<Home />} />
                </Routes>
              </ErrorBoundary>
            </div>
            <Footer />
          </div>
        </PriceUnitProvider>
      )}
    </I18nProvider>
  )
}

export default App
