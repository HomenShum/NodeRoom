import { test, expect, enterDemoRoom, publicChat } from "./fixtures";

const ARTIFACT_REF_MIME = "application/x-noderoom-artifact";

/**
 * Real-DOM chat coverage (memory mode, no backend). Proves the Wave-1 optimistic / honest-status
 * fixes through the actual rendered UI — the layer convex-test and unit tests cannot reach.
 */
test.describe("chat — optimistic send + edit (memory mode)", () => {
  test.beforeEach(async ({ page }) => { await enterDemoRoom(page); });

  test("send renders an instant, stably-keyed, confirmed bubble", async ({ page }) => {
    const chat = publicChat(page);
    const body = `hello-${test.info().testId}-${Date.now().toString(36)}`;
    await chat.getByTestId("chat-composer").fill(body);
    await chat.getByTestId("chat-send").click();

    const bubble = chat.getByTestId("chat-message").filter({ hasText: body });
    await expect(bubble).toBeVisible();
    // Memory writes are synchronous → the bubble is confirmed, never stuck in the pending state.
    await expect(bubble).toHaveAttribute("data-state", "confirmed");
    // The stable clientMsgId key means the bubble is a single node, not a remounted duplicate.
    await expect(bubble).toHaveCount(1);
  });

  test("editing own message paints the new text in place", async ({ page }) => {
    const chat = publicChat(page);
    const body = `editme-${Date.now().toString(36)}`;
    await chat.getByTestId("chat-composer").fill(body);
    await chat.getByTestId("chat-send").click();

    const bubble = chat.getByTestId("chat-message").filter({ hasText: body });
    await expect(bubble).toBeVisible();
    await bubble.getByTestId("chat-edit").click();
    const editor = bubble.getByRole("textbox", { name: /edit message/i });
    await editor.fill(`${body}-edited`);
    await bubble.getByTestId("chat-edit-save").click();

    await expect(chat.getByTestId("chat-message").filter({ hasText: `${body}-edited` })).toBeVisible();
    await expect(bubble.getByTestId("chat-edit-error")).toHaveCount(0);
  });

  test("can send an artifact reference without extra text", async ({ page }) => {
    const chat = publicChat(page);
    const source = page.getByTestId("left-rail").getByTestId("binder-artifact").filter({ hasText: "Q3 variance" }).first();
    const id = await source.getAttribute("data-artifact-id");
    const kind = await source.getAttribute("data-artifact-kind");
    expect(id).toBeTruthy();
    expect(kind).toBeTruthy();
    const ref = {
      id: id!,
      kind: kind!,
      title: "Q3 variance",
    };

    await chat.evaluate((node, { mime, ref }) => {
      const dt = new DataTransfer();
      dt.setData(mime, JSON.stringify(ref));
      node.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, { mime: ARTIFACT_REF_MIME, ref });
    await expect(chat.locator(".r-ref-chip").filter({ hasText: "Q3 variance" })).toBeVisible();
    await expect(chat.getByTestId("chat-send")).toBeEnabled();
    await chat.getByTestId("chat-send").click();

    const bubble = chat.getByTestId("chat-message").filter({ hasText: "Q3 variance" }).last();
    await expect(bubble).toBeVisible();
    await expect(bubble.locator(".r-msg-ref")).toContainText("Q3 variance");
    const clientMsgId = await bubble.getAttribute("data-clientmsgid");
    expect(clientMsgId).toBeTruthy();
    const stableBubble = chat.locator(`[data-testid="chat-message"][data-clientmsgid="${clientMsgId}"]`);

    await stableBubble.hover();
    await stableBubble.getByTestId("chat-edit").click();
    const editBox = stableBubble.getByLabel("Edit message");
    await expect(editBox).toHaveValue("");
    await editBox.fill("Use this artifact for source-backed diligence.");
    await stableBubble.getByTestId("chat-edit-save").click();

    await expect(stableBubble.locator(".r-msg-ref")).toContainText("Q3 variance");
    await expect(stableBubble).toContainText("Use this artifact for source-backed diligence.");
    await expect(stableBubble).not.toContainText("References:");
  });

  test("chat artifact references open beside the primary work surface on desktop", async ({ page }) => {
    const chat = publicChat(page);
    const source = page.getByTestId("left-rail").getByTestId("binder-artifact").filter({ hasText: "Diligence memo" }).first();
    const id = await source.getAttribute("data-artifact-id");
    const kind = await source.getAttribute("data-artifact-kind");
    expect(id).toBeTruthy();
    expect(kind).toBeTruthy();

    await chat.evaluate((node, { mime, ref }) => {
      const dt = new DataTransfer();
      dt.setData(mime, JSON.stringify(ref));
      node.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, { mime: ARTIFACT_REF_MIME, ref: { id: id!, kind: kind!, title: "Diligence memo" } });
    await chat.getByTestId("chat-send").click();

    const ref = chat.getByTestId("chat-message").filter({ hasText: "Diligence memo" }).locator(".r-msg-ref").first();
    await expect(ref).toBeVisible();
    await ref.click();

    await expect(page.getByTestId("work-surface")).toHaveAttribute("data-split", "true");
    await expect(page.getByTestId("artifact-panel-secondary")).toBeVisible();
  });

  test("mobile chat artifact references switch back to the work surface", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await enterDemoRoom(page);

    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click();
    const source = page.getByTestId("left-rail").getByTestId("binder-artifact").filter({ hasText: "Diligence memo" }).first();
    const id = await source.getAttribute("data-artifact-id");
    const kind = await source.getAttribute("data-artifact-kind");
    expect(id).toBeTruthy();
    expect(kind).toBeTruthy();

    await page.getByRole("button", { name: "Toggle Copilot panel" }).click();
    const chat = publicChat(page);
    await expect(chat).toBeVisible();
    await chat.evaluate((node, { mime, ref }) => {
      const dt = new DataTransfer();
      dt.setData(mime, JSON.stringify(ref));
      node.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, { mime: ARTIFACT_REF_MIME, ref: { id: id!, kind: kind!, title: "Diligence memo" } });
    await chat.getByTestId("chat-send").click();

    const ref = chat.getByTestId("chat-message").filter({ hasText: "Diligence memo" }).locator(".r-msg-ref").first();
    await expect(ref).toBeVisible();
    await ref.click();

    await expect(page.getByTestId("work-surface")).toBeVisible();
    await expect(page.getByTestId("copilot-panel")).toHaveCount(0);
  });

  test("dropping a file into chat uploads it and attaches a reference", async ({ page }) => {
    const chat = publicChat(page);

    await chat.evaluate((node) => {
      const file = new File(["Company,ARR\nCardioNova,1200000\n"], "drop.csv", { type: "text/csv" });
      const dt = new DataTransfer();
      dt.items.add(file);
      node.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    });

    await expect(chat.locator(".r-ref-chip").filter({ hasText: "drop.csv" })).toBeVisible();
    await expect(chat.getByTestId("chat-upload-error")).toHaveCount(0);
    await expect(chat.getByTestId("chat-send")).toBeEnabled();
  });

  test("paperclip upload attaches a file reference from the composer", async ({ page }) => {
    const chat = publicChat(page);

    await expect(chat.getByTestId("chat-attach")).toBeVisible();
    const chooserPromise = page.waitForEvent("filechooser");
    await chat.getByTestId("chat-attach").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "paperclip.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Company,ARR\nCardioNova,1200000\n"),
    });

    await expect(chat.locator(".r-ref-chip").filter({ hasText: "paperclip.csv" })).toBeVisible();
    await expect(chat.getByTestId("chat-upload-error")).toHaveCount(0);
    await expect(chat.getByTestId("chat-send")).toBeEnabled();
  });

  test("pasting a file into the composer uploads it as a reference", async ({ page }) => {
    const chat = publicChat(page);
    const composer = chat.getByTestId("chat-composer");
    await composer.focus();

    await composer.evaluate((node) => {
      const file = new File(["Company,ARR\nCardioNova,1200000\n"], "pasted.csv", { type: "text/csv" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: dt });
      node.dispatchEvent(event);
    });

    await expect(chat.locator(".r-ref-chip").filter({ hasText: "pasted.csv" })).toBeVisible();
    await expect(chat.getByTestId("chat-upload-error")).toHaveCount(0);
    await expect(chat.getByTestId("chat-send")).toBeEnabled();
  });

  test("@nodeagent quick chips replace /ask and /free as the taught public agent UX", async ({ page }) => {
    const chat = publicChat(page);

    // Quick chips are context-aware (they vary by the active artifact — diligence/runway/enrich/
    // organize/memo), so assert the durable contract, not a fixed prompt pair: @nodeagent chips are
    // present and the legacy /ask + /free slash chips are gone.
    const agentChips = chat.locator(".r-composer-hint .r-chip").filter({ hasText: /^@nodeagent / });
    await expect(agentChips.first()).toBeVisible();
    await expect(chat.locator(".r-composer-hint .r-chip").filter({ hasText: /^\/(ask|free)\b/ })).toHaveCount(0);

    // Clicking a chip prefills the composer with its @nodeagent goal (label is the goal's prefix).
    const label = ((await agentChips.first().textContent()) ?? "").trim();
    await agentChips.first().click();
    await expect(chat.getByTestId("chat-composer")).toHaveValue(new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
