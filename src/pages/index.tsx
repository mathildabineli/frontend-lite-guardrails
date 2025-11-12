// src/pages/index.tsx
export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1>Frontend Lite Guardrails</h1>
      <a href="/moderation-test" style={{ color: '#2563eb' }}>
        Go to moderation test page →
      </a>
    </main>
  );
}
