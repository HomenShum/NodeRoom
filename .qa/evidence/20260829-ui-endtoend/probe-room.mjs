// Repro probes: Enter-commit on sheet cell, +N overflow menu, NodeBook tab state.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const base = process.argv[2] ?? 'http://localhost:5260';
const out = process.argv[3] ?? 'probe-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

await page.goto(base + '/?mode=memory', { waitUntil: 'networkidle' });
await page.click('[data-testid="start-demo-room"]');
await page.waitForSelector('[data-testid="left-rail"]', { timeout: 15000 });
try { await page.click('[data-testid="tour-skip"]', { timeout: 3000 }); } catch {}

// 1) Enter-commit: click Revenue variance "+ add", type, press Enter
await page.click('text=Q3 variance');
await page.waitForTimeout(800);
const addBtns = page.locator('.r-sheet button:has-text("add"), [data-testid="sheet-grid"] :text("add")');
console.log('add affordances:', await addBtns.count());
await addBtns.first().click();
await page.waitForTimeout(300);
const input = page.locator('.r-cell-input');
console.log('editor open:', await input.count());
await input.first().fill('2400');
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
const stillOpen = await input.count();
const committed = await page.locator('text=2,400').count() + await page.locator('td:has-text("2400")').count();
console.log('ENTER-COMMIT => editor still open:', stillOpen, '| committed cells found:', committed);
await page.screenshot({ path: out + '/enter-commit.png' });

// 2) +N overflow menu
const summary = page.locator('summary[aria-label="All open tabs"]');
console.log('overflow summary count:', await summary.count());
if (await summary.count()) {
  await summary.first().click();
  await page.waitForTimeout(400);
  const menuItems = page.locator('.r-tab-overflow-menu [role="menuitem"]');
  const visible = await menuItems.first().isVisible().catch(() => false);
  console.log('OVERFLOW-MENU => items:', await menuItems.count(), '| first visible:', visible);
  await page.screenshot({ path: out + '/overflow-menu.png' });
  await page.keyboard.press('Escape');
}

// 3) NodeBook tab
await page.click('[data-testid="nodebook-tab"]');
await page.waitForTimeout(1200);
await page.screenshot({ path: out + '/nodebook-tab.png' });
const nbText = await page.locator('[data-testid="work-surface"]').innerText().catch(() => '(no work-surface)');
console.log('NODEBOOK first 300 chars:', nbText.replace(/\n+/g, ' | ').slice(0, 300));
console.log('pageerrors:', errors);
await browser.close();
