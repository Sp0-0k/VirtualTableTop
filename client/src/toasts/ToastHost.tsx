import { useToasts, type Toast } from './store.js';

function bgFor(level: Toast['level']): string {
  return level === 'error' ? '#fdecea' : '#eef4ff';
}
function borderFor(level: Toast['level']): string {
  return level === 'error' ? '#e74c3c' : '#3498db';
}

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.level === 'error' ? 'alert' : 'status'}
          onClick={() => dismiss(t.id)}
          style={{
            background: bgFor(t.level),
            border: `1px solid ${borderFor(t.level)}`,
            borderRadius: 6,
            padding: '8px 12px',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
            color: '#222',
            cursor: 'pointer',
            pointerEvents: 'auto',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
