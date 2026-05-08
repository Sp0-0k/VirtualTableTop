import { useRef, useState } from 'react';
import { useDmStore } from '../stores/dmStore.js';
import { deleteAsset, listTokenAssets, uploadTokenAsset, type ApiAsset } from '../api.js';

export function TokenLibrary() {
  const assets = useDmStore((s) => s.assets.filter((a) => a.kind === 'token'));
  const setAssets = useDmStore((s) => s.setAssets);
  const upsertAsset = useDmStore((s) => s.upsertAsset);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const tokenAssets = await listTokenAssets();
    const allAssets = useDmStore.getState().assets;
    const maps = allAssets.filter((a) => a.kind === 'map');
    setAssets([...maps, ...tokenAssets]);
  }

  async function onUpload(file: File) {
    setError(null);
    try {
      const asset = await uploadTokenAsset(file);
      upsertAsset(asset);
    } catch (e) {
      setError((e as Error).message);
    }
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

  void refresh;

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong>Tokens</strong>
        <button onClick={() => fileInput.current?.click()}>+ Upload</button>
        <input
          ref={fileInput} type="file" accept="image/*" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onUpload(f);
            e.target.value = '';
          }}
        />
      </div>
      {error && <div style={{ color: '#d44', fontSize: 12, marginBottom: 6 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 64px)', gap: 6 }}>
        {assets.map((a) => (
          <div
            key={a.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/x-vtt-asset', String(a.id))}
            style={{ position: 'relative', width: 64, height: 64, border: '1px solid #444', cursor: 'grab' }}
            title={a.originalName}
          >
            <img
              src={`/assets/${a.hash}.thumb.webp`} alt={a.originalName}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
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
    </div>
  );
}
