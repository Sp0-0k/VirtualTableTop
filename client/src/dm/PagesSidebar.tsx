import { useDmStore } from '../stores/dmStore.js';
import { deletePage as apiDeletePage, setActivePage as apiSetActivePage } from '../api.js';

interface Props {
  onNewPage: () => void;
}

export default function PagesSidebar({ onNewPage }: Props) {
  const pages = useDmStore((s) => s.pages);
  const selectedPageId = useDmStore((s) => s.selectedPageId);
  const selectPage = useDmStore((s) => s.selectPage);

  async function handleSetActive(id: number) {
    try {
      await apiSetActivePage(id);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete page "${name}"?`)) return;
    try {
      await apiDeletePage(id);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <section style={{ borderBottom: '1px solid #ddd', padding: '0.75rem' }}>
      <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Pages</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {pages.map((p) => (
          <li
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.25rem',
              background: selectedPageId === p.id ? '#eef' : 'transparent',
              cursor: 'pointer',
            }}
            onClick={() => selectPage(p.id)}
          >
            <span style={{ flex: 1 }}>
              {p.name}
              {p.is_active === 1 && <strong title="active"> ★</strong>}
            </span>
            {p.is_active === 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSetActive(p.id);
                }}
                style={{ fontSize: '0.75rem' }}
              >
                Set active
              </button>
            )}
            <button
              type="button"
              aria-label={`delete ${p.name}`}
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(p.id, p.name);
              }}
              style={{ fontSize: '0.75rem' }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onNewPage} style={{ marginTop: '0.5rem' }}>
        + New page
      </button>
    </section>
  );
}
