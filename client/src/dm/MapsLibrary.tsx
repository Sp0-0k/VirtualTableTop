import { useRef, useState } from 'react';
import { useDmStore } from '../stores/dmStore.js';
import { deleteAsset, uploadMapAsset, type ApiAsset } from '../api.js';

export default function MapsLibrary() {
  const assets = useDmStore((s) => s.assets.filter((a) => a.kind === 'map'));
  const upsertAsset = useDmStore((s) => s.upsertAsset);
  const setAssets = useDmStore((s) => s.setAssets);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        const asset = await uploadMapAsset(file);
        upsertAsset(asset);
      } catch (err) {
        alert(`upload failed: ${(err as Error).message}`);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function onDelete(asset: ApiAsset) {
    if (!confirm(`Delete "${asset.originalName}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteAsset(asset.id);
      const next = useDmStore.getState().assets.filter((a) => a.id !== asset.id);
      setAssets(next);
    } catch (e) {
      const refs = (e as Error & { references?: { pages: { name: string }[]; tokens: { name: string | null }[] } }).references;
      if (refs) {
        const parts: string[] = [];
        if (refs.pages.length) parts.push(`${refs.pages.length} page(s): ${refs.pages.map((p) => `'${p.name}'`).join(', ')}`);
        if (refs.tokens.length) parts.push(`${refs.tokens.length} token(s)`);
        setError(`In use by ${parts.join(' and ')}. Remove references first.`);
      } else {
        setError((e as Error).message);
      }
    }
  }

  return (
    <section style={{ padding: '0.75rem' }}>
      <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Maps</h3>
      {error && <div style={{ color: '#d44', fontSize: 12, marginBottom: 6 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
        {assets.map((a) => (
          <div
            key={a.id}
            title={a.originalName}
            style={{
              position: 'relative',
              aspectRatio: '1',
              background: '#f0f0f0',
              backgroundImage: `url(/assets/${a.hash}.thumb.webp)`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              border: '1px solid #ccc',
            }}
          >
            <button
              onClick={() => onDelete(a)}
              title="Delete"
              style={{
                position: 'absolute', top: 0, right: 0,
                background: 'rgba(0,0,0,0.7)', color: '#fff', border: 0,
                width: 18, height: 18, fontSize: 12, cursor: 'pointer',
              }}
            >×</button>
          </div>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        style={{ marginTop: '0.5rem' }}
      />
    </section>
  );
}
