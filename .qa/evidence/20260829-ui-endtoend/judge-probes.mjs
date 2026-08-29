// fable-judge probes: observed proof for three claims that were only reasoned about.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const base = process.argv[2] ?? 'http://localhost:5260';
mkdirSync('judge-probes', { recursive: true });
const browser = await chromium.launch();

// ── Probe 1+2: story drills — conflict pane + proposal chip static, approve is a plain button
{
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(base + '/#story', { waitUntil: 'networkidle' });
  await page.getByTestId('story-lab').scrollIntoViewIfNeeded();
  // run the no-clobber drill: type into a variance cell then press the AI-overwrite button
  const runBtn = page.locator('[data-testid="story-lab"] button', { hasText: 'Let the AI try to overwrite my edit' });
  await runBtn.click();
  await page.waitForSelector('.sl-conflict', { timeout: 20000 });
  const conflict = await page.$eval('.sl-conflict', el => ({ anims: el.getAnimations({ subtree: false }).length, text: el.innerText.slice(0, 60), tag: el.tagName }));
  console.log('CONFLICT PANE =>', JSON.stringify(conflict));
  await page.screenshot({ path: 'judge-probes/conflict-pane.png' });

  // rebase drill: run, then check proposal chip + approve button
  await page.getByTestId('story-lab-rebase-run').scrollIntoViewIfNeeded();
  await page.getByTestId('story-lab-rebase-run').click();
  await page.waitForSelector('[data-testid="story-lab-rebase-proposal"]', { timeout: 25000 });
  const chip = await page.$eval('[data-testid="story-lab-rebase-proposal"]', el => ({ anims: el.getAnimations().length, tag: el.tagName }));
  const approve = await page.$eval('[data-testid="story-lab-rebase-approve"]', el => ({ tag: el.tagName, cls: el.className }));
  console.log('PROPOSAL CHIP =>', JSON.stringify(chip), '| APPROVE =>', JSON.stringify(approve));
  await page.screenshot({ path: 'judge-probes/proposal-chip.png' });
  await page.close();
}

// ── Probe 3: reduced motion — entrances collapse to visible final state
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(base + '/#story', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const hero = await page.$eval('.rs-hero-h1', el => ({ opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform }));
  console.log('REDUCED-MOTION HERO =>', JSON.stringify(hero));
  await page.screenshot({ path: 'judge-probes/reduced-motion-story.png' });
  await ctx.close();
}

// ── Probe 4: needs-review chip is a BUTTON that routes (memory demo room)
{
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(base + '/?mode=memory', { waitUntil: 'networkidle' });
  await page.click('[data-testid="start-demo-room"]');
  await page.waitForSelector('[data-testid="left-rail"]', { timeout: 20000 });
  try { await page.click('[data-testid="tour-skip"]', { timeout: 3000 }); } catch {}
  // trigger a run that produces a needs_review receipt
  await page.click('text=@nodeagent diligence CardioNova');
  await page.getByTestId('chat-send').first().click();
  await page.waitForSelector('[data-testid="agent-research-outcome"]', { timeout: 60000 });
  const chips = await page.$$eval('[data-testid="agent-research-outcome"]', els => els.map(e => ({ tag: e.tagName, outcome: e.dataset.outcome, text: e.innerText })));
  console.log('RECEIPT CHIPS =>', JSON.stringify(chips.slice(-3)));
  const btn = page.locator('button[data-testid="agent-research-outcome"]').last();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(1500);
    const split = await page.locator('[data-testid="artifact-tabs-secondary"], .r-split, [data-testid="work-surface"]').count();
    const cellVisible = await page.locator('[data-cell-key]').count();
    console.log('CHIP CLICK => split-ish containers:', split, '| cells visible:', cellVisible);
    await page.screenshot({ path: 'judge-probes/chip-routes.png' });
  } else {
    console.log('CHIP CLICK => no needs_review button rendered in this run (all Complete)');
  }
  await page.close();
}
await browser.close();
