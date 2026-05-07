import { useState } from 'react';
import { useDmStore } from '../stores/dmStore.js';
import { createPage } from '../api.js';

interface Props {
  onClose: () => void;
}

export default function NewPageModal({ onClose }: Props) {
  const assets = useDmStore((s) => s.assets);
  const upsertPage = useDmStore((s) => s.upsertPage);
  const [name, setName] = useState('');
  const [assetId, setAssetId] = useState<number | null>(assets[0]?.id ?? null);
  const [width, setWidth] = useState(20);
  const [height, setHeight] = useState(15);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (assetId === null) {
      setError('Upload a map first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const page = await createPage({
        name: name.trim(),
        background_asset_id: assetId,
        grid_width_squares: width,
        grid_height_squares: height,
      });
      upsertPage(page);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="New page"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: 8,
          minWidth: 320,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        <h2 style={{ margin: 0 }}>New page</h2>
        <label>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label>
          Map background
          <select
            value={assetId ?? ''}
            onChange={(e) => setAssetId(e.target.value ? Number(e.target.value) : null)}
            required
            style={{ display: 'block', width: '100%' }}
          >
            <option value="" disabled>
              {assets.length === 0 ? '— upload one first —' : '— pick a map —'}
            </option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.originalName}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <label style={{ flex: 1 }}>
            Grid width (squares)
            <input
              type="number"
              min={1}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              style={{ display: 'block', width: '100%' }}
            />
          </label>
          <label style={{ flex: 1 }}>
            Grid height (squares)
            <input
              type="number"
              min={1}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              style={{ display: 'block', width: '100%' }}
            />
          </label>
        </div>
        {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting || name.trim().length === 0}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
