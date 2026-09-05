from pathlib import Path
import json,hashlib
O=Path(__file__).resolve().parent
s=(O/'browser-proof-02.spec.ts.txt').read_text(encoding='utf-8')
s=s.replace('  // Preserve transient screenshots in the prior run; these captures show the settled outcome after the real edit toast expires.\n  await expect(page.locator(\'.na-toast[data-show="true"]\')).toHaveCount(0);\n','')
s=s[:s.index('test("rapidly closing an export')]+r'''test("closing a preparing table suppresses its later result and permits a fresh export", async ({ page }, info) => {
  await openTable(page, info, 390);
  await editProduct(page, "Temporary current value");
  await openExport(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let held!: () => void;
  const requested = new Promise<void>((resolve) => { held = resolve; });
  const heldRequests: string[] = [];
  await page.route("**/assets/*.js", async (route) => {
    heldRequests.push(new URL(route.request().url()).pathname);
    held();
    await gate;
    await route.continue();
  });
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await tableDialog(page).getByTestId("mobile-table-export-download").dblclick({ delay: 20 });
  await Promise.race([requested, new Promise((_, reject) => setTimeout(() => reject(new Error("No deferred export import observed")), 7000))]);
  await expect(tableDialog(page).getByTestId("mobile-table-export-download")).toBeDisabled();
  await capture(page, info, "preparing-before-close");
  await tableDialog(page).getByRole("button", { name: "Close", exact: true }).click();
  release();
  await page.waitForLoadState("networkidle");
  expect(downloads).toHaveLength(0);
  await writeFile(info.outputPath("held-imports.json"), JSON.stringify(heldRequests, null, 2));
  await page.unroute("**/assets/*.js");
  await page.locator('.na-rcard[data-kind="sheet"]').first().click();
  await editProduct(page, "New explicit export after reopen");
  await openExport(page);
  const event = page.waitForEvent("download");
  await tableDialog(page).getByTestId("mobile-table-export-download").click();
  await readDownload(await event, info, "reopened-after-cancel", "New explicit export after reopen");
  expect(downloads).toHaveLength(1);
  await capture(page, info, "reopened-after-cancel");
});
'''
expected=json.loads(next((O/'browser-proof-01/artifacts').glob('*/source-bindings.json')).read_text(encoding='utf-8'))['e2e/mobile-sample-workbook-export.spec.ts']
actual=hashlib.sha256(s.encode('utf-8')).hexdigest()
assert actual==expected,(actual,expected)
(O/'browser-proof-01.spec.ts.txt').write_text(s,encoding='utf-8',newline='\n')
(O/'initial-probe-source-restoration.json').write_text(json.dumps({'method':'Reconstructed from retained next revision by reversing the exact capture/closing-test delta; accepted only after SHA256 matches the original per-test receipt','expected':expected,'actual':actual,'matches':True},indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'matches':True,'sha256':actual}))
