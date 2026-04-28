# Virtual Tabletop

Single-campaign D&D virtual tabletop. Hosts the visual/spatial layer of play
(maps, tokens, fog of war) for one DM and a small group of players.

## Documents

- Design spec: [`docs/superpowers/specs/2026-04-27-vtt-design.md`](docs/superpowers/specs/2026-04-27-vtt-design.md)
- Implementation plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)

## Development

```bash
npm install
npm run dev:server   # in one terminal
npm run dev:client   # in another terminal
```

Server runs on :3002, client dev server on :5173 (Vite default), proxying
`/api` and `/socket.io` to the server.

## Tests

```bash
npm test          # one-shot
npm run test:watch
npm run typecheck
```

## Deploy

See [`docs/DEPLOY.md`](docs/DEPLOY.md).
