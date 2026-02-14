import React from 'react'

type Props = { children: React.ReactNode; fallback?: React.ReactNode }
type State = { hasError: boolean }

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: any, info: any) {
    console.error('ErrorBoundary', error, info)
  }
  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="rounded-2xl border p-6 bg-red-50 text-red-800">
          <p className="text-lg font-extrabold">Ha ocurrido un error</p>
          <div className="mt-2 flex items-center gap-3">
            <button className="px-4 py-2 rounded-full border bg-white" onClick={() => this.setState({ hasError: false })}>Reintentar</button>
            <button className="px-4 py-2 rounded-full border bg-white" onClick={() => location.reload()}>Recargar</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
