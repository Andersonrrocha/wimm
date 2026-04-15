function App(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '0.5rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>Wimm</h1>
      <p style={{ color: '#888', fontSize: '1rem' }}>Personal Finance Tracker</p>
      <p style={{ color: '#555', fontSize: '0.875rem', marginTop: '1rem' }}>
        Phase 1 — Project Foundation
      </p>
    </div>
  )
}

export default App
