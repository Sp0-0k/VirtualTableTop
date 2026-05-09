import { useDmStore } from '../stores/dmStore.js';
import { clearFog, revealAllFog } from '../api.js';

const SIZE_MIN = 8;
const SIZE_MAX = 400;

export function FogDock() {
  const fog = useDmStore((s) => s.fogSettings);
  const setFog = useDmStore((s) => s.setFogSettings);
  const activePageId = useDmStore((s) => s.activePageId);
  const selectedPageId = useDmStore((s) => s.selectedPageId);
  const targetPageId = selectedPageId ?? activePageId;

  async function handleClear() {
    if (targetPageId === null) return;
    if (!window.confirm('This will re-fog the entire page. Continue?')) return;
    await clearFog(targetPageId);
  }

  async function handleRevealAll() {
    if (targetPageId === null) return;
    if (!window.confirm('This will reveal the entire page to players. Continue?')) return;
    await revealAllFog(targetPageId);
  }

  const styles = {
    bar: {
      position: 'absolute',
      left: 16, right: 16, bottom: 16,
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '8px 12px',
      background: 'rgba(20, 20, 24, 0.92)',
      color: '#eee',
      borderRadius: 8,
      border: '1px solid #444',
      fontSize: 13,
      zIndex: 10,
    } as const,
    sep: { width: 1, alignSelf: 'stretch', background: '#444' } as const,
    seg: { display: 'flex', gap: 0, border: '1px solid #555', borderRadius: 4, overflow: 'hidden' } as const,
    segBtn: (active: boolean) => ({
      padding: '4px 10px',
      background: active ? '#3a6' : 'transparent',
      color: active ? '#fff' : '#ccc',
      border: 'none',
      cursor: 'pointer',
    }) as const,
    bulkBtn: {
      padding: '4px 10px',
      background: '#522',
      color: '#fff',
      border: '1px solid #844',
      borderRadius: 4,
      cursor: 'pointer',
    } as const,
  };

  return (
    <div style={styles.bar} role="toolbar" aria-label="Fog tools">
      <div style={styles.seg}>
        <button
          type="button"
          style={styles.segBtn(fog.mode === 'reveal')}
          onClick={() => setFog({ mode: 'reveal' })}
        >Reveal</button>
        <button
          type="button"
          style={styles.segBtn(fog.mode === 'hide')}
          onClick={() => setFog({ mode: 'hide' })}
        >Hide</button>
      </div>

      <div style={styles.sep} />

      <div style={styles.seg}>
        <button
          type="button"
          style={styles.segBtn(fog.shape === 'brush')}
          onClick={() => setFog({ shape: 'brush' })}
        >Brush</button>
        <button
          type="button"
          style={styles.segBtn(fog.shape === 'rect')}
          onClick={() => setFog({ shape: 'rect' })}
        >Rect</button>
      </div>

      <div style={styles.sep} />

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: fog.shape === 'rect' ? 0.4 : 1 }}>
        Size
        <input
          type="range"
          min={SIZE_MIN}
          max={SIZE_MAX}
          value={fog.radius}
          disabled={fog.shape === 'rect'}
          onChange={(e) => setFog({ radius: Number(e.target.value) })}
        />
        <span style={{ width: 56, textAlign: 'right' }}>{fog.radius}px</span>
      </label>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button type="button" style={styles.bulkBtn} onClick={handleClear}>
          Reset to fogged
        </button>
        <button type="button" style={styles.bulkBtn} onClick={handleRevealAll}>
          Reveal everything
        </button>
      </div>
    </div>
  );
}
