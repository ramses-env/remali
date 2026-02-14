import { Route, Routes } from 'react-router-dom'
import Navbar from './components/Navbar'
import Home from './routes/Home'
// import ProductList from './routes/ProductList'
// import ProductDetail from './routes/ProductDetail'
import Cart from './routes/Cart'
import Checkout from './routes/Checkout'
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

function App() {
  const { token } = useAuth()
  const { user } = useProfile()
  return (
    <PriceUnitProvider>
      <div className="min-h-screen flex flex-col bg-white text-neutral-900 transition-colors">
        <Navbar />
        <RouteLoader />
        <div className="flex-1 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 w-full">
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
