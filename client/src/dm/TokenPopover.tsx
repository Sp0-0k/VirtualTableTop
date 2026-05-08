import { useState } from 'react';
import { deleteToken, patchToken, type Token, type Player } from '../api.js';

const CONDITIONS = [
  'blinded','charmed','deafened','frightened','grappled','incapacitated',
  'invisible','paralyzed','petrified','poisoned','prone','restrained',
  'stunned','unconscious','exhaustion',
] as const;

interface Props {
  token: Token;
  players: Player[];
  onClose: () => void;
}

export function TokenPopover({ token, players, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function patch<K extends keyof Parameters<typeof patchToken>[1]>(
    key: K,
    value: Parameters<typeof patchToken>[1][K],
  ) {
    setBusy(true); setErr(null);
    try {
      await patchToken(token.id, { [key]: value } as Parameters<typeof patchToken>[1]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleCondition(c: string) {
    const has = token.conditions.includes(c);
    const next = has ? token.conditions.filter((x) => x !== c) : [...token.conditions, c];
    await patch('conditions', next);
  }

  async function onDelete() {
    if (!confirm(`Delete "${token.name ?? 'token'}"?`)) return;
    setBusy(true);
    try { await deleteToken(token.id); onClose(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ background: '#222', color: '#eee', padding: 12, border: '1px solid #555', minWidth: 240 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Token</strong>
        <button onClick={onClose}>×</button>
      </div>
      {err && <div style={{ color: '#f88', fontSize: 12 }}>{err}</div>}

      <label>Name <input
        defaultValue={token.name ?? ''}
        onBlur={(e) => patch('name', e.target.value || null)}
      /></label>

      <label>Owner <select
        defaultValue={token.owner_player_id ?? ''}
        onChange={(e) => patch('owner_player_id', e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="">— unowned (DM) —</option>
        {players.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select></label>

      <label>Size <input
        type="number" min={1} max={4} defaultValue={token.size_squares}
        onBlur={(e) => patch('size_squares', Number(e.target.value))}
      /></label>

      <label>
        <input type="checkbox" checked={!!token.hidden}
          onChange={(e) => patch('hidden', e.target.checked ? 1 : 0)} /> Hidden
      </label>

      <fieldset>
        <legend>HP</legend>
        <label>Current <input
          type="number" defaultValue={token.current_hp ?? ''}
          onBlur={(e) => patch('current_hp', e.target.value === '' ? null : Number(e.target.value))}
        /></label>
        <label>Max <input
          type="number" defaultValue={token.max_hp ?? ''}
          onBlur={(e) => patch('max_hp', e.target.value === '' ? null : Number(e.target.value))}
        /></label>
        <label>
          <input type="checkbox" checked={token.hp_visible_to_players !== 0}
            onChange={(e) => patch('hp_visible_to_players', e.target.checked ? 1 : 0)} />
          Players see HP
        </label>
      </fieldset>

      <fieldset>
        <legend>Conditions</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {CONDITIONS.map((c) => (
            <button
              key={c}
              onClick={() => toggleCondition(c)}
              style={{
                background: token.conditions.includes(c) ? '#5a8' : '#333',
                color: '#fff', border: '1px solid #555', padding: '2px 6px', fontSize: 11,
              }}
            >{c}</button>
          ))}
        </div>
      </fieldset>

      <button onClick={onDelete} disabled={busy} style={{ marginTop: 8, color: '#f88' }}>Delete token</button>
    </div>
  );
}
