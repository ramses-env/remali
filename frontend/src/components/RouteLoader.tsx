import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Loader from './Loader'

export default function RouteLoader() {
  const location = useLocation()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => setLoading(false), 700)
    return () => clearTimeout(t)
  }, [location.pathname])

  return loading ? <Loader /> : null
}

