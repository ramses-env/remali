import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useProfile } from '../store/profile'

export default function Profile() {
  const { token } = useAuth()
  const { user, refresh } = useProfile()
  const nav = useNavigate()

  useEffect(() => {
    if (!token) nav('/login')
    else if (!user) refresh()
  }, [token])

  const name = `${user?.first_name || ''} ${user?.last_name || ''}`.trim()

  return (
    <div className="max-w-2xl mx-auto">
      <div className="rounded-3xl border p-6 bg-white shadow-sm">
        <h1 className="text-2xl font-extrabold tracking-tight mb-4">Mi perfil</h1>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-neutral-600">Nombre</span>
            <span className="font-medium">{name || user?.username}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-600">Correo</span>
            <span className="font-medium">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-600">Usuario</span>
            <span className="font-medium">{user?.username}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

