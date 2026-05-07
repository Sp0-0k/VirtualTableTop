import { useState } from 'react';
import { joinAsPlayer, type Player } from './api.js';

const COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71',
  '#1abc9c', '#3498db', '#9b59b6', '#e84393',
];

interface Props {
  onJoined: (player: Player) => void;
}

export default function NamePicker({ onJoined }: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[5]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const player = await joinAsPlayer(name.trim(), color);
      onJoined(player);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 400 }}>
      <h2>Pick a name</h2>
      <label style={{ display: 'block', marginBottom: '0.5rem' }}>
        Name:
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          required
          autoFocus
          style={{ marginLeft: '0.5rem', padding: '0.25rem' }}
        />
      </label>
      <fieldset style={{ border: 'none', padding: 0, marginBottom: '0.5rem' }}>
        <legend>Color:</legend>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`color ${c}`}
              aria-pressed={color === c}
              style={{
                width: 32,
                height: 32,
                background: c,
                border: color === c ? '3px solid #000' : '1px solid #ccc',
                borderRadius: '50%',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      </fieldset>
      <button type="submit" disabled={submitting || name.trim().length === 0}>
        {submitting ? 'Joining…' : 'Join'}
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </form>
  );
}
