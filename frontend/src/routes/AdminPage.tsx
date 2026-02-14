import ErrorBoundary from '../components/ErrorBoundary'
import AdminDashboard from './AdminDashboard'

export default function AdminPage() {
  return (
    <ErrorBoundary fallback={
      <div className="min-h-[60vh] grid place-items-center">
        <div className="text-center space-y-2">
          <p className="text-xl font-bold">No se pudo cargar el panel</p>
          <p className="text-sm text-neutral-600">Revisa tu conexión o permisos.</p>
        </div>
      </div>
    }>
      <AdminDashboard />
    </ErrorBoundary>
  )
}
