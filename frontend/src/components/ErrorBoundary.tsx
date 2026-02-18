import React from 'react'
import ErrorPage from '../routes/ErrorPage'

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
      return <ErrorPage type="500" />
    }
    return this.props.children
  }
}
