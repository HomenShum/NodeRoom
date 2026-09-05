import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
const port = 54512;
await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => server.close(resolve));
});
const child = spawn(process.execPath, ['scripts/run-product-memory-playwright.mjs'], {
  cwd: process.cwd(), stdio: 'inherit', windowsHide: true,
  env: { ...process.env, CI: '', PRODUCT_MEMORY_SKIP_BUILD: '1', PRODUCT_MEMORY_SERVER: 'preview', PLAYWRIGHT_PORT: String(port), PLAYWRIGHT_REUSE_SERVER: '0' },
});
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
process.exitCode = code ?? 1;
