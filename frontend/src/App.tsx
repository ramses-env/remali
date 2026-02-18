import { Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import Navbar from './components/Navbar'
import Home from './routes/Home'
import Cart from './routes/Cart'
import Checkout from './routes/Checkout'
import AdminPage from './routes/AdminPage'
import Login from './routes/Login'
import Profile from './routes/Profile'
import { useAuth } from './store/auth'
import { useProfile } from './store/profile'
import FloatingCart from './components/FloatingCart'
import Footer from './components/Footer'
import RouteLoader from './components/RouteLoader'
import ErrorBoundary from './components/ErrorBoundary'
import { PriceUnitProvider } from './store/priceUnit'
import EquiposList from './routes/EquiposList'
import EquipoDetail from './routes/EquipoDetail'
import Cotizacion from './routes/Cotizacion'
import ErrorPage from './routes/ErrorPage'

function App() {
  const { token } = useAuth()
  const { user } = useProfile()
  const isAdmin = user ? (user.is_staff || (user?.groups || []).includes('Administrador')) : null
  const location = useLocation()
  const isHome = location.pathname === '/'

  // Force dark mode on Home page
  useEffect(() => {
    if (isHome) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isHome])

  return (
    <PriceUnitProvider>
      <div className={`min-h-screen flex flex-col transition-colors ${isHome ? 'bg-neutral-950 text-white dark' : 'bg-white text-neutral-900'}`}>
        <Navbar />
        <RouteLoader />
        <div className={`flex-1 w-full min-h-[50vh] ${isHome ? '' : 'pt-24 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6'}`}>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/equipos" element={<EquiposList />} />
              <Route path="/equipo/:id" element={<EquipoDetail />} />
              <Route path="/carrito" element={<Cart />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/cotizacion" element={<Cotizacion />} />
              <Route path="/login" element={<Login />} />
              <Route path="/perfil" element={token ? <Profile /> : <Login />} />
              <Route path="/admin" element={token ? (isAdmin === false ? <Login /> : <AdminPage />) : <Login />} />
              <Route path="/500" element={<ErrorPage type="500" />} />
              <Route path="/403" element={<ErrorPage type="403" />} />
              <Route path="*" element={<ErrorPage type="404" />} />
            </Routes>
          </ErrorBoundary>
        </div>
        <FloatingCart />
        <Footer />
      </div>
    </PriceUnitProvider>
  )
}

export default App
