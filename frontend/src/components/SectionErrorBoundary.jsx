import React from 'react'

class SectionErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error(`[SectionError] ${this.props.name || 'Unknown'}:`, error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 m-4">
          <h3 className="text-red-800 font-semibold text-sm">Error en {this.props.name || 'esta sección'}</h3>
          <p className="text-red-600 text-xs mt-1">{this.state.error?.message || 'Error desconocido'}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-2 text-xs text-red-700 underline hover:text-red-900"
          >
            Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default SectionErrorBoundary
