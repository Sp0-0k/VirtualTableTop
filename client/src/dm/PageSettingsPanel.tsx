import { useDmStore } from '../stores/dmStore.js';
import { patchPage } from '../api.js';

export function PageSettingsPanel() {
  const page = useDmStore((s) =>
    s.selectedPageId ? s.pages.find((p) => p.id === s.selectedPageId) ?? null : null,
  );
  if (!page) return null;
  return (
    <div style={{ padding: 8, borderTop: '1px solid #333' }}>
      <strong>Page settings</strong>
      <label>Width (squares) <input
        type="number" min={1} defaultValue={page.grid_width_squares}
        onBlur={(e) => patchPage(page.id, { grid_width_squares: Number(e.target.value) })}
      /></label>
      <label>Height (squares) <input
        type="number" min={1} defaultValue={page.grid_height_squares}
        onBlur={(e) => patchPage(page.id, { grid_height_squares: Number(e.target.value) })}
      /></label>
    </div>
  );
}
