import { loadConfig } from './lib/config.js';
import * as store from './lib/store.js';
import { createApp } from './lib/app.js';

const config = loadConfig();
const PORT = process.env.PORT || config.port || 3333;

const app = await createApp();
await store.load();
app.listen(PORT, '127.0.0.1', () => {
  console.log(`${config.name} PM Dashboard → http://localhost:${PORT}`);
});
