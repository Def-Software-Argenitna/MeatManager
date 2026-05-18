import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        this.setState({
            error: error,
            errorInfo: errorInfo
        });
        console.error("Uncaught error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            const errorMessage = this.state.error ? this.state.error.toString() : '';
            const isChunkLoadError =
                errorMessage.includes('Failed to fetch dynamically imported module') ||
                errorMessage.includes('Importing a module script failed') ||
                errorMessage.includes('ChunkLoadError');

            return (
                <div style={{ padding: '2rem', color: '#ef4444', backgroundColor: '#1a1a1a', height: '100vh' }}>
                    <h1>{isChunkLoadError ? 'La aplicacion se actualizo.' : 'Algo salió mal.'}</h1>
                    {isChunkLoadError && (
                        <div style={{ marginTop: '1rem', color: '#d1d5db', maxWidth: '42rem', lineHeight: 1.6 }}>
                            Hay archivos viejos en memoria del navegador y esta pantalla necesita la ultima version.
                            <div style={{ marginTop: '1rem' }}>
                                <button
                                    onClick={() => window.location.reload()}
                                    style={{
                                        background: '#f97316',
                                        color: '#111',
                                        border: 'none',
                                        borderRadius: '10px',
                                        padding: '0.8rem 1rem',
                                        fontWeight: 800,
                                        cursor: 'pointer'
                                    }}
                                >
                                    Recargar aplicacion
                                </button>
                            </div>
                        </div>
                    )}
                    <details style={{ whiteSpace: 'pre-wrap', marginTop: '1rem' }}>
                        {this.state.error && this.state.error.toString()}
                        <br />
                        {this.state.errorInfo && this.state.errorInfo.componentStack}
                    </details>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
