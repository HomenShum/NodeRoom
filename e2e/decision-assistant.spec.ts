import { test, expect, enterDemoRoom, publicChat } from "./fixtures";

test("decision assistant summarizes a completed research run and pre-fills next actions", async ({ page }) => {
  await enterDemoRoom(page);

  await page
    .getByTestId("left-rail")
    .getByTestId("binder-artifact")
    .filter({ hasText: "Company research" })
    .first()
    .click();

  const chat = publicChat(page);
  await expect(chat.getByTestId("chat-composer")).toBeVisible();
  await chat
    .getByTestId("chat-composer")
    .fill("@nodeagent diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps");
  await chat.getByTestId("chat-send").click();

  const agentReceipt = chat.getByTestId("chat-feed").getByTestId("agent-research-receipt")
    .filter({ hasText: /Researched 1 company with structured fields/i }).first();
  await expect(agentReceipt.getByText(/Researched 1 company with structured fields/i)).toBeVisible({ timeout: 30_000 });
  // Agent-commits policy moved into the settings panel (design-target parity); open it to read state.
  await page.getByTestId("room-settings-btn").click();
  await expect(page.getByTestId("agent-commit-policy")).toContainText(/Agent commits:\s*auto-allow/i);
  await page.getByTestId("room-settings-btn").click();

  await expect(agentReceipt).toBeVisible();
  await expect(agentReceipt).toContainText(/CardioNova/i);
  await expect(agentReceipt.getByTestId("agent-source-receipt")).toHaveText("2 sources");
  await expect(agentReceipt.getByTestId("agent-version-receipt")).toContainText(/v\d+\s*->\s*v\d+/);
  await expect(agentReceipt.getByTestId("agent-lock-released-receipt")).toContainText(/lock released/i);
  await expect(agentReceipt.getByTestId("agent-view-row")).toBeVisible();

  const decision = chat.getByTestId("decision-assistant");
  await chat.hover();
  await expect(decision).toBeVisible();
  await expect(decision).toContainText("CardioNova is ready for review");
  await expect(decision).toContainText(/\d+\/14 complete/);
  await expect(decision).toContainText("Sources");
  await expect(decision).toContainText("Pending");
  await expect(decision.getByRole("button", { name: "Find evidence gaps" })).toBeVisible();

  const sheet = page.getByTestId("sheet-grid");
  const statusCell = sheet.locator('[data-cell-key="rc_cardionova__status"]');
  await expect(statusCell.getByTestId("grid-status-chip")).toHaveText("complete");
  await expect(statusCell.getByTestId("grid-cite-chip")).toHaveText("2 src");
  await expect(sheet.locator('[data-cell-key="rc_cardionova__owner"]').getByTestId("grid-owner-chip")).toContainText("Maya");
  await expect(page.locator(".r-sheet-bar").getByTestId("grid-column-count")).toHaveText("6 of 14 cols");
  await page.getByTestId("grid-column-count").click();
  await page.getByRole("menu").getByRole("checkbox", { name: "source", exact: true }).check();
  await expect(sheet.locator('[data-cell-key="rc_cardionova__source"]').getByTestId("grid-source-chip")).toHaveCount(1);
  await expect(sheet.locator(".r-row-empty")).toHaveCount(0);
  await expect(sheet.getByTestId("grid-add-row")).toBeVisible();
  await statusCell.getByTestId("grid-cite-chip").hover();
  await expect(statusCell.getByTestId("grid-cite-popover")).toBeVisible();
  await expect(statusCell.getByTestId("grid-cite-popover")).toContainText(/cardionova/i);

  const gridVisualState = await statusCell.evaluate((cell) => {
    const row = cell.closest("tr");
    const websiteValue = document.querySelector('[data-cell-key="rc_cardionova__website"] .r-cell-value');
    const cellStyle = getComputedStyle(cell);
    const statusStyle = getComputedStyle(cell.querySelector('[data-testid="grid-status-chip"]') as HTMLElement);
    const valueStyle = websiteValue ? getComputedStyle(websiteValue) : null;
    return {
      rowHeight: row?.getBoundingClientRect().height ?? 0,
      outlineColor: cellStyle.outlineColor,
      statusTextTransform: statusStyle.textTransform,
      whiteSpace: valueStyle?.whiteSpace,
      overflow: valueStyle?.overflow,
      textOverflow: valueStyle?.textOverflow,
    };
  });
  expect(Math.round(gridVisualState.rowHeight)).toBe(44);
  expect(gridVisualState.statusTextTransform).toBe("none");
  expect(gridVisualState.whiteSpace).toBe("nowrap");
  expect(gridVisualState.overflow).toBe("hidden");
  expect(gridVisualState.textOverflow).toBe("ellipsis");

  await statusCell.click();
  const selectedOutline = await statusCell.evaluate((cell) => getComputedStyle(cell).outlineColor);
  expect(selectedOutline).not.toBe("rgb(31, 138, 91)");

  await chat.hover();
  await decision.getByRole("button", { name: "Find evidence gaps" }).click();
  await expect(chat.getByTestId("chat-composer")).toHaveValue(/@nodeagent identify remaining evidence gaps for CardioNova/i);
});
