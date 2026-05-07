import { useRef } from 'react';
import { useDmStore } from '../stores/dmStore.js';
import { uploadMapAsset } from '../api.js';

export default function MapsLibrary() {
  const assets = useDmStore((s) => s.assets);
  const upsertAsset = useDmStore((s) => s.upsertAsset);
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

  return (
    <section style={{ padding: '0.75rem' }}>
      <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Maps</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
        {assets.map((a) => (
          <div
            key={a.id}
            title={a.originalName}
            style={{
              aspectRatio: '1',
              background: '#f0f0f0',
              backgroundImage: `url(/assets/${a.hash}.thumb.webp)`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              border: '1px solid #ccc',
            }}
          />
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
