import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { reopenLendingPacketBundle, stableDigest } from "../src/domains/smbLending";

const STATE_KEY = "noderoom:smb-lending:golden-slice:v1";

test("governs request, evidence verification, packet export/reopen, and reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.goto("/#smb-lending");
  await page.evaluate((key) => window.localStorage.removeItem(key), STATE_KEY);
  await page.reload();

  const proofBar = page.getByTestId("smb-lending-proof-bar");
  await expect(proofBar).toBeVisible();
  await expect(page.getByTestId("smb-lending-evidence-state")).toContainText("missing");
  await page.getByTestId("signal-review").click();

  let card = page.getByTestId("proposal-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("requested");
  await expect(card).toContainText("Governed proposal");
  await card.getByTestId("proposal-approve").click();

  card = page.getByTestId("proposal-card");
  await expect(card).toHaveCount(1);
  await expect(page.getByTestId("smb-lending-evidence-state")).toContainText("requested");
  await expect(card).toContainText("verified");
  await expect(card).toContainText("sha256:synthetic-bank-statements-q2");
  await card.getByTestId("proposal-approve").click();

  await expect(page.getByTestId("proposal-card")).toHaveCount(0);
  await expect(page.getByTestId("smb-lending-evidence-state")).toContainText("verified");
  await expect(proofBar).toContainText("src-bank-statements-q2");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("smb-lending-export-bundle").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("bay-hearth-working-capital-human-review-packet.json");
  const path = await download.path();
  expect(path).toBeTruthy();
  const serialized = await readFile(path!, "utf8");
  const reopened = reopenLendingPacketBundle(serialized);
  expect(reopened.application.version).toBe(3);
  expect(reopened.packet.blockers).toHaveLength(0);
  expect(reopened.packet.decision).toBe("not_made");
  expect(reopened.receipt.applicationHash).toBe(stableDigest(reopened.application));
  expect(reopened.receipt.packetHash).toBe(stableDigest(reopened.packet));
  await expect(page.getByTestId("smb-lending-export-result")).toContainText("Reopened and verified");
  await page.screenshot({
    path: "docs/release/proof/20260721-smb-lending-room/smb-lending-verified-export-reopen-1440x900.png",
    fullPage: true,
  });

  const persisted = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), STATE_KEY);
  expect(persisted.phase).toBe("verified");
  await page.reload();
  await expect(page.getByTestId("smb-lending-evidence-state")).toContainText("verified");
  await expect(page.getByTestId("proposal-card")).toHaveCount(0);
  await page.screenshot({
    path: "docs/release/proof/20260721-smb-lending-room/smb-lending-verified-export-reopen-reload-1440x900.png",
    fullPage: true,
  });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

for (const viewport of [
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`keeps verified proof controls reachable on ${viewport.name}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(({ key, bundle }) => {
      window.localStorage.setItem(key, JSON.stringify({ phase: "verified", bundle, persistedAt: "2026-07-21T00:00:00.000Z" }));
    }, { key: STATE_KEY, bundle: JSON.parse(JSON.stringify({ schemaVersion: "proof-bound-in-test" })) });
    await page.goto("/#smb-lending");
    await expect(page.getByTestId("smb-lending-evidence-state")).toContainText("verified");
    await expect(page.getByTestId("smb-lending-export-bundle")).toBeEnabled();
    const box = await page.getByTestId("smb-lending-export-bundle").boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(consoleErrors).toEqual([]);
    await page.screenshot({
      path: `docs/release/proof/20260721-smb-lending-room/smb-lending-verified-${viewport.name}-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  });
}
