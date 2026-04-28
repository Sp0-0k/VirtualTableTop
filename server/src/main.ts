import { createServer } from './server.js';

const server = createServer();
const port = Number(process.env.PORT ?? 3002);
server.listen(port, () => {
  console.log(`vtt server listening on :${port}`);
});
