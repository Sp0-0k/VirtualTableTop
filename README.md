# Virtual Tabletop

Single-campaign D&D virtual tabletop. Hosts the visual/spatial layer of play
(maps, tokens, fog of war) for one DM and a small group of players.

## Documents

- Design spec: [`docs/superpowers/specs/2026-04-27-vtt-design.md`](docs/superpowers/specs/2026-04-27-vtt-design.md)
- Implementation plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)

## Development

```bash
cp .env.example .env
# Edit .env and set APP_SECRET to anything (e.g. `openssl rand -hex 32`).

npm install
npm run dev:server   # in one terminal — listens on :3002
npm run dev:client   # in another — Vite dev server on :5173, proxies API
```

The Vite dev server proxies `/api` and `/socket.io` to :3002, so open
`http://localhost:5173/` (player view) or `http://localhost:5173/dm` (DM view).
There is no Basic Auth gate in dev — that's a Caddy concern, exercised only in prod.

## Tests

```bash
npm test          # one-shot
npm run test:watch
npm run typecheck
```

## Deploy

See [`docs/DEPLOY.md`](docs/DEPLOY.md).
