import { test, expect, type Page } from "@playwright/test";
import { enableFocusModeForTest, expectFocusModeOn } from "./focusMode";

/**
 * Hackathon Loop Engineering E2E — three personas exercise the NodeAgent
 * with You.com research tools and observe the loop engineering feedback
 * (plan → act → observe → evaluate → report) in the live UI.
 *
 * Prerequisites:
 *   - E2E_CONVEX_URL or VITE_CONVEX_URL must point to a live Convex deployment
 *   - YOUCOM_API_KEY must be set in the Convex deployment
 *   - Dev server must be running (npm run dev)
 */

const HAS_LIVE_BACKEND =
  !!process.env.E2E_CONVEX_URL ||
  !!process.env.VITE_CONVEX_URL ||
  process.env.E2E_LIVE_APP === "1";

test.skip(!HAS_LIVE_BACKEND, "set E2E_CONVEX_URL/VITE_CONVEX_URL or E2E_LIVE_APP=1 against a deployed live app");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureBinderOpen(page: Page) {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click();
  }
  await expect(leftRail).toBeVisible({ timeout: 10_000 });
}

async function openFreshLiveDemoRoom(page: Page, code: string, name: string) {
  await enableFocusModeForTest(page);
  await page.goto(`/?demo=${code}&name=${name}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("public-chat-panel").getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
  await expectFocusModeOn(page);
  await ensureBinderOpen(page);
}

async function openFreshLiveBlankRoom(page: Page, name: string) {
  await enableFocusModeForTest(page);
  await page.goto(`/?name=${name}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("create-room").click({ timeout: 60_000 });
  await page.getByTestId("create-room-submit").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("create-room-submit").click();
  await expect(page.getByTestId("public-chat-panel").getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
  await expectFocusModeOn(page);
}

function publicChat(page: Page) {
  return page.getByTestId("public-chat-panel");
}

async function sendAgentMessage(page: Page, prompt: string) {
  const chat = publicChat(page);
  await chat.getByTestId("chat-composer").fill(prompt);
  await chat.getByTestId("chat-send").click();
  await expect(chat.getByTestId("chat-message").filter({ hasText: prompt })).toBeVisible({ timeout: 15_000 });
}

async function waitForAgentJobStarted(page: Page) {
  const chat = publicChat(page);
  await expect(chat.getByTestId("job-status")).toContainText(/queued|running|completed|blocked|failed/i, { timeout: 30_000 });
  await expect(chat.getByTestId("agent-error")).toHaveCount(0);
}

async function waitForAgentStream(page: Page) {
  const chat = publicChat(page);
  const stream = chat.getByTestId("agent-unified-stream").first();
  await expect(stream).toBeVisible({ timeout: 90_000 });
  await expect(stream.locator('[data-part="step"], [data-part="tool"], [data-testid="agent-stream-text"]').first()).toBeVisible({
    timeout: 90_000,
  });
  return stream;
}

async function waitForAgentCompletion(page: Page, timeoutMs = 300_000) {
  const chat = publicChat(page);
  await expect(chat.getByTestId("job-status")).toContainText(/completed/i, { timeout: timeoutMs });
}

async function openJobDetails(page: Page) {
  const chat = publicChat(page);
  await chat.getByTestId("job-detail-toggle").click();
  const detail = chat.getByTestId("job-detail");
  await expect(detail).toContainText(/Runtime|Policy|Model calls|Tool calls/i, { timeout: 15_000 });
  return detail;
}

// ─── Persona 1: Hackathon Developer ───────────────────────────────────────────

test.describe("Hackathon Developer — finance research + SEC cross-check", () => {
  test("developer asks for NVIDIA finance research with SEC cross-check, observes loop engineering", async ({ page }) => {
    test.setTimeout(360_000);
    const code = `HKD${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "DevAlex");

    // Developer asks a finance research question that should trigger you_finance_research and sec_facts
    const prompt = "@nodeagent Use you_finance_research to analyze NVIDIA's FY2025 revenue growth drivers. What were the key segments and how much did each contribute? Cross-check with sec_facts for the exact revenue number.";
    await sendAgentMessage(page, prompt);

    // Job starts
    await waitForAgentJobStarted(page);

    // Stream appears with tool/step parts
    const stream = await waitForAgentStream(page);

    // Wait for completion (finance research can take up to 300s)
    await waitForAgentCompletion(page, 360_000);

    // Verify the agent produced a final answer
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/NVIDIA|revenue|Data Center/i, { timeout: 30_000 });

    // Open job details and verify loop engineering trace
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Model calls|Tool calls/i);

    // Verify the spreadsheet was populated (agent should have written cells)
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
    const firstDataCell = page.locator('[data-element-id="r2__A"]').first();
    await expect(firstDataCell).toBeVisible({ timeout: 30_000 });
  });

  test("developer observes richer streaming UX — plan card, progress bar, reasoning", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `HKD${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "DevAlex2");

    const prompt = "@nodeagent research NVIDIA's top 3 competitors and their market share vs NVIDIA in AI GPUs. Write a comparison table.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);

    // Check for the new streaming UX elements
    const chat = publicChat(page);
    const stream = chat.getByTestId("agent-unified-stream").first();

    // Progress card should be visible
    await expect(stream.getByTestId("agent-progress-card")).toBeVisible({ timeout: 90_000 });

    // If the agent produced a plan, the plan card should be visible
    const planCard = stream.getByTestId("agent-plan-card");
    const hasPlan = await planCard.isVisible().catch(() => false);
    if (hasPlan) {
      await expect(planCard).toContainText(/Game plan/i);
    }

    // Progress bar should appear if step_start events have maxSteps metadata
    const progressBar = stream.getByTestId("agent-progress-bar");
    const hasProgress = await progressBar.isVisible().catch(() => false);
    if (hasProgress) {
      await expect(progressBar).toContainText(/Step \d+\/\d+/i);
    }

    // Wait for completion
    await waitForAgentCompletion(page, 300_000);
  });
});

// ─── Persona 2: Hackathon Judge — quick diligence check ───────────────────────

test.describe("Hackathon Judge — quick diligence with web search", () => {
  test("judge asks for a quick company overview using web search", async ({ page }) => {
    test.setTimeout(180_000);
    const code = `HKJ${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "JudgeSam");

    // Judge wants a quick overview — should trigger you_search (faster than finance research)
    const prompt = "@nodeagent search the web for OpenAI's latest funding round and valuation. Summarize key facts.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    // Wait for completion (web search is faster)
    await waitForAgentCompletion(page, 180_000);

    // Verify the agent produced text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/OpenAI|funding|valuation/i, { timeout: 30_000 });

    // Open trace details
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });
});

// ─── Persona 3: Non-Technical Participant — natural language research ─────────

test.describe("Non-Technical Participant — natural language research request", () => {
  test("non-technical user asks a plain-English question and gets a clear answer", async ({ page }) => {
    test.setTimeout(240_000);
    const code = `HKN${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveBlankRoom(page, "NonTechPat");

    // Non-technical user asks in plain English — agent should use research tools
    const prompt = "@nodeagent I'm at a hackathon and need to understand what Tesla's main business segments are and how much revenue each makes. Can you research that and put it in a table?";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    // Wait for completion
    await waitForAgentCompletion(page, 240_000);

    // Verify the agent produced readable text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Tesla|revenue|segment/i, { timeout: 30_000 });

    // Verify a sheet was created (agent should materialize a spreadsheet)
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });
});

// ─── Persona 4: VC Partner (Mark Liu) — portfolio company diligence ──────────

test.describe("VC Partner (Mark Liu) — UpScaleX portfolio research", () => {
  // UpScaleX portfolio companies verified from LinkedIn deep dive (55 company posts, 9 Mark Liu posts, 32 Alan Zong posts):
  //   MAI Agents ($25M seed led by Kleiner Perkins, AI performance marketing, founder Yuchen W. ex-Google Ads + Instacart VP)
  //   Blueberry (commerce agent that sells via social DMs, founder Nima Mozhgani ex-Snapchat, 10M social interactions processed)
  //   Expertise AI (AI sales assistant + booking, founder Hao Sheng ex-Google ex-Cresta, $1M ARR 15% MoM growth, #1 HubSpot Marketplace)
  //   BeFreed (audio agent for learning, founder Jisong L. ex-Pinterest & Google AI eng, $100K ARR in 6 weeks, 200K+ organic users)
  //   Dex / WorldDex (AI learning camera for kids, founder Reni Cao, Nick Carter testimonial)
  //   Dimension Studios (AI OS for TikTok Shop, founder Ali Mirzaei, eight-figure exit at 18, 600M+ views)
  //   Make the Dot (AI fashion design, founders Emilie H. + Jeremiah M.)
  //   Daxo (dexterous robotic hands, founder Tom Zhang Cornell + UPenn PhD robotics)
  //   Sentrial (agent reliability testing, founder Neel Sharma, YC W26)
  //   AdsGency AI (ad optimization, founder Bolbi Liu ex-AWS, $0→$10M ARR in 10 months, ~$100M ad spend)
  //   Curator (AI ops platform JARVIS, founders Adam Morgan + Pavan Otthi)
  //   Sourcy (supply chain/sourcing, founder Karl Chan)
  //   Midas Touch (consumer commerce, founder Cordelia Xiao ex-AliExpress Europe head, Stanford GSB MBA)
  //   WorkDuo AI (agentic commerce, founder Fiona Lau ex-Shopline 9-figure exit)
  //   Corgi Labs (agentic commerce payments, founder Saif Farooqui)
  //   Kite (agentic commerce payments, founder Chi Zhang)
  //   ShiptAI (shipping/logistics AI, founders Richard Rabbat + Darya Melicher + Bryan Wilson)
  // Co-founder: Alan Zong (ex-Head of Innovation Investment at Alibaba International,
  //   ex-P&G brand manager, 10+ years VC/CVC, early backer of unicorns/decacorns,
  //   9th year HBS NVC mentor/judge, 400+ portfolio founders in ecosystem)

  test("Mark researches portfolio company MAI — funding, traction, and competitive landscape", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `VCM${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "MarkLiu");

    // Mark wants a quick diligence snapshot of MAI using web search
    const prompt = "@nodeagent search the web for MAI Agents (mai.co) — AI performance marketing startup backed by UpScaleX. Find their $25M seed round led by Kleiner Perkins, founder Yuchen W.'s background (ex-Google Ads ML, ex-Instacart VP Growth), their autonomous Google Ads agent product, MAI Insights + MAI Canvas launch for Prime Day, and top 3 competitors. Put the key facts in a spreadsheet.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    // Wait for completion
    await waitForAgentCompletion(page, 300_000);

    // Verify the agent produced text about MAI
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/MAI|marketing|funding|\$25M/i, { timeout: 30_000 });

    // Verify a spreadsheet was populated
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 30_000 });

    // Open trace details
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });

  test("Mark researches Make the Dot — AI fashion design platform traction", async ({ page }) => {
    test.setTimeout(240_000);
    const code = `VCM${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "MarkLiu2");

    const prompt = "@nodeagent use you_search to research Make the Dot — an AI fashion design platform backed by UpScaleX, founded by Emilie H. and Jeremiah M. Find their product, recent partnerships with fashion brands, and market size for AI in fashion design. Write results in a table.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 240_000);

    // Verify text output mentions the company or founder
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Make the Dot|fashion|Emilie|design/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
  });

  test("Mark researches Dex — AI learning camera for kids, including Nick Carter testimonial angle", async ({ page }) => {
    test.setTimeout(240_000);
    const code = `VCD${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "MarkLiu3");

    const prompt = "@nodeagent research Dex — an AI-powered learning camera that helps kids learn new languages, founded by Reni Cao and backed by UpScaleX. Find their product details, target market, seed funding, and any notable customer testimonials (including the Nick Carter/Backstreet Boys angle). Summarize in a table.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 240_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Dex|camera|language|kids|Reni/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
  });

  test("Mark does a batch portfolio overview — all 5 key companies in one room", async ({ page }) => {
    test.setTimeout(360_000);
    const code = `VCB${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveBlankRoom(page, "MarkLiu4");

    // Mark asks for a batch overview of 5 portfolio companies
    const prompt = "@nodeagent research these 5 UpScaleX portfolio companies and build a comparison spreadsheet with columns: Company, Product, Sector, Funding Stage, Key Differentiator:\n1. MAI Agents — AI performance marketing, $25M seed led by Kleiner Perkins, founder Yuchen W. ex-Google\n2. Blueberry — commerce agent that sells via social DMs, founder Nima Mozhgani ex-Snapchat, 10M interactions processed\n3. Expertise AI — AI sales assistant + booking calendar, founder Hao Sheng ex-Google, $1M ARR\n4. BeFreed — audio agent for personalized learning, founder Jisong L. ex-Pinterest & Google, $100K ARR in 6 weeks\n5. Daxo — dexterous robotic hands, founder Tom Zhang Cornell + UPenn PhD robotics\nUse you_search for each company and fill the spreadsheet.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    // Wait for completion (batch research takes longer)
    await waitForAgentCompletion(page, 360_000);

    // Verify the agent produced text about the portfolio
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/MAI|Blueberry|Expertise|BeFreed|Daxo|portfolio/i, { timeout: 30_000 });

    // Verify spreadsheet with multiple rows (at least 3 data rows for 5 companies)
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r3__A"]').first()).toBeVisible({ timeout: 30_000 });

    // Open trace details — should show multiple tool calls for batch research
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });
});

// ─── Persona 5: Co-Founder Connection Mapping (Alan Zong) ───────────────────

test.describe("Co-Founder Connections — Alan Zong investment background", () => {
  // Alan Zong: Co-Founder & Partner at UpScaleX, ex-Head of Innovation Investment
  // at Alibaba International, Harvard MBA, 10+ years VC/CVC, early backer of
  // unicorns and decacorns. Investments in AI, blockchain, gaming, metaverse.

  test("research Alan Zong's investment track record from Alibaba days", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `ACA${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "MarkLiu5");

    // Mark wants to understand Alan's prior investments to leverage his network
    const prompt = "@nodeagent research Alan Zong — Co-Founder and Partner at UpScaleX, previously Head of Innovation Investment at Alibaba International, ex-P&G brand manager. Find his notable investments at Alibaba (AI, blockchain, gaming, metaverse sectors), companies he backed that became unicorns or decacorns, his 9th year as HBS NVC mentor/judge, and his P&G consumer brand background. Build a spreadsheet of his investment track record.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    // Verify text output mentions Alan or his background
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Alan|Zong|Alibaba|investment|UpScaleX|Harvard/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 30_000 });

    // Open trace details
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });

  test("map UpScaleX co-founder network — shared investments and synergies", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `ACN${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveBlankRoom(page, "MarkLiu6");

    // Mark wants to map the co-founder network and find synergy opportunities
    const prompt = "@nodeagent research the UpScaleX team and their combined investment network:\n1. Alan Zong — ex-Alibaba Innovation Investment, ex-P&G brand manager, unicorn/decacorn backer, 400+ portfolio founders\n2. Mark Liu — Investor & Sector Lead AI, applied AI and agentic systems specialist\n3. Zidi Zhang — team member, investment/GTM/ecosystem building\nUse you_search to find any shared investments, co-investors, or portfolio companies that both Alan and Mark have touched. Build a network mapping spreadsheet with columns: Person, Role, Prior Firm, Notable Investments, Sector Focus.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Alan|Mark|UpScaleX|Alibaba|investment|network/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("research UpScaleX event presence and community engagement", async ({ page }) => {
    test.setTimeout(240_000);
    const code = `ACE${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "MarkLiu7");

    // Mark attends events and wants to track UpScaleX's event presence
    const prompt = "@nodeagent search the web for UpScaleX events, demo days, and community engagement. Find:\n1. Events where UpScaleX partners spoke or attended (e.g. 'Beyond the Horizon: AI & Digital Commerce', AI Builders Social)\n2. Portfolio company demo days\n3. Mark Liu's event participation (Cookiy AI's AI Builders Social)\nBuild a spreadsheet tracking events, dates, speakers, and portfolio companies showcased.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 240_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/event|UpScaleX|demo|social|builder/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
  });
});

// ─── Persona 6: Portfolio CEO (Emilie Ho, Make the Dot) — board prep ────────

test.describe("Portfolio CEO — board update room for investor", () => {
  // Emilie Ho is Co-Founder & CEO of Make the Dot (AI fashion design platform).
  // She uses NodeRoom to prepare a board update for Mark Liu at UpScaleX.

  test("Emilie builds a board update with metrics, milestones, and competitive landscape", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `BOD${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveBlankRoom(page, "EmilieHo");

    const prompt = "@nodeagent I'm the CEO of Make the Dot, an AI fashion design platform backed by UpScaleX (founders Emilie H. and Jeremiah M.). I need to prepare a board update for my investor Mark Liu at UpScaleX. Research our top 3 competitors (Cala, Resleeve, Vizcom) and build a spreadsheet with columns: Competitor, Product Focus, Funding Stage, Key Customers, Differentiator vs Make the Dot. Also search for recent news about AI in fashion design.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    // Verify the agent produced text about competitors or board update
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/competitor|fashion|board|Make the Dot|Cala|Vizcom|Resleeve/i, { timeout: 30_000 });

    // Verify spreadsheet was created with competitor data
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r2__A"]').first()).toBeVisible({ timeout: 30_000 });

    // Open trace details
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });

  test("Emilie researches her own market size and growth trajectory for board deck", async ({ page }) => {
    test.setTimeout(240_000);
    const code = `BOM${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "EmilieHo2");

    const prompt = "@nodeagent use you_search to research the AI fashion design market size, growth rate, and key trends for 2025-2026. I need this for a board presentation to UpScaleX. Find: total addressable market, CAGR, key drivers (3D design, virtual sampling, sustainability), and any analyst reports. Put the data in a table.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 240_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/market|fashion|AI|design|TAM|CAGR|growth/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
  });

  test("Emilie shares product milestone update and agent researches comparable milestones", async ({ page }) => {
    test.setTimeout(240_000);
    const code = `BOP${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveBlankRoom(page, "EmilieHo3");

    const prompt = "@nodeagent I'm preparing a milestone update for Make the Dot's board. We just launched our AI-powered virtual sampling feature and partnered with a billion-dollar fashion brand. Research what milestones other AI fashion startups (Cala, Vizcom, Resleeve) have hit in the last 12 months — funding rounds, product launches, brand partnerships. Build a comparison table so I can show our progress relative to peers.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 240_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/milestone|launch|partnership|funding|Cala|Vizcom|Resleeve|Make the Dot/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 30_000 });
  });
});

// ─── Persona 7: Portfolio CEO (Reni Cao, Dex) — investor demo room ──────────

test.describe("Portfolio CEO — product demo and investor update", () => {
  // Reni Cao is Co-Founder & CEO of Dex (AI learning camera for kids).
  // He uses NodeRoom to share a demo room with Mark for async product review.

  test("Reni prepares an investor demo room with product research and user feedback", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `DEX${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveBlankRoom(page, "ReniCao");

    const prompt = "@nodeagent I'm Reni Cao, CEO of Dex — an AI-powered learning camera that helps kids learn new languages through play. We're backed by UpScaleX (Alan Zong led the investment). I'm preparing an investor update. Research:\n1. The children's EdTech market size and growth rate\n2. Competitors in AI learning devices for kids (e.g. Moxie, Roybi, CogniToys)\n3. Recent customer traction signals (Nick Carter from Backstreet Boys gave a testimonial, parent reviews)\n4. Our product at dex.camera\nBuild a spreadsheet with: Market Metric, Value, Source, Date so I can share this room with Mark Liu.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Dex|EdTech|kids|language|market|competitor|Moxie|Roybi/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });

    // Open trace details
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });

  test("Reni researches language learning market trends for pitch enrichment", async ({ page }) => {
    test.setTimeout(240_000);
    const code = `DLM${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "ReniCao2");

    const prompt = "@nodeagent search the web for the language learning market for children — market size, growth rate, key trends (AI tutors, gamification, hardware-based learning), and notable funding rounds in the space. I need this for a pitch to potential co-investors alongside UpScaleX. Summarize key findings in a table.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 240_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/language|learning|market|children|AI|tutor|gamification/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
  });
});

// ─── Persona 8: Mark's LP Connection — independent diligence review ─────────

test.describe("LP Connection — independent deal review in shared room", () => {
  // A limited partner in UpScaleX's fund wants to review a deal Mark shared.
  // Mark shares a room code; the LP enters and does their own diligence.

  test("LP enters Mark's shared room and runs independent diligence on MAI", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `LPD${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "LPJordan");

    // LP wants to independently verify Mark's investment thesis on MAI
    const prompt = "@nodeagent I'm an LP reviewing a deal that Mark Liu at UpScaleX shared — MAI Agents (mai.co), an AI performance marketing startup that raised $25M seed led by Kleiner Perkins. Founder Yuchen W. previously built Google Ads ML systems and was Instacart VP of Growth. I need independent diligence:\n1. Search for MAI's actual product (autonomous Google Ads agent, MAI Insights, MAI Canvas), revenue model, and customer base\n2. Find who else invested in the $25M round beyond Kleiner Perkins and UpScaleX\n3. Research the AI performance marketing market size and competition (Skai, Albert AI, Morphio)\n4. Check if there are any red flags or negative press\nBuild a diligence spreadsheet with: Question, Finding, Source, Confidence Level.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/MAI|marketing|diligence|investor|revenue|competition|Skai|Albert/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r3__A"]').first()).toBeVisible({ timeout: 30_000 });

    // Open trace details
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });

  test("LP researches UpScaleX fund track record before committing capital", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `LPT${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveBlankRoom(page, "LPJordan2");

    const prompt = "@nodeagent I'm considering committing capital to UpScaleX's fund. Research their track record:\n1. All known portfolio companies and their current status — verified list includes: MAI Agents ($25M from Kleiner Perkins), Blueberry (10M social interactions), Expertise AI ($1M ARR), BeFreed ($100K ARR 200K users), Dex (AI camera for kids), Dimension Studios (TikTok Shop AI), Daxo (robotic hands), Sentrial (YC W26), AdsGency AI ($10M ARR), Curator, Sourcy, Midas Touch, WorkDuo AI, Corgi Labs, Kite, ShiptAI\n2. Any portfolio companies that have raised follow-on rounds\n3. Co-investors they've worked with (Kleiner Perkins, a16z ecosystem)\n4. Alan Zong's track record from Alibaba Innovation Investment + P&G brand background\n5. Mark Liu's applied AI and agentic systems focus\nBuild a fund diligence spreadsheet with: Metric, Value, Source, Notes.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/UpScaleX|portfolio|track|fund|Alan|Zong|Alibaba|Mark|Liu/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });
});

// ─── Persona 9: Co-Founder (Alan Zong) — collaborative diligence ───────────

test.describe("Co-Founder (Alan Zong) — collaborative diligence with Mark", () => {
  // Alan and Mark co-review a potential investment. Alan brings his Alibaba
  // network and AI/blockchain expertise; Mark brings PE discipline.

  test("Alan researches a potential deal using his Alibaba network context", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `ALA${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "AlanZong");

    const prompt = "@nodeagent I'm Alan Zong, co-founder of UpScaleX. I previously led innovation investments at Alibaba International in AI, blockchain, gaming, and metaverse, and before that I was a brand manager at P&G. I'm evaluating a new deal in the AI agent orchestration space. Research:\n1. The ontology-first AI orchestration market (companies like Lindy, Beam, Orama)\n2. Any Alibaba-backed companies in this space that could be strategic partners\n3. Recent funding rounds in AI agent infrastructure\n4. Key differentiators between orchestration platforms\nBuild a comparison spreadsheet with: Company, Product, Funding, Strategic Fit, Alibaba Synergy Potential.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/orchestration|AI agent|Lindy|Beam|Orama|Alibaba|funding|infrastructure/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });

    // Open trace details
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });

  test("Alan and Mark compare investment theses on a shared deal", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `ACT${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveBlankRoom(page, "AlanZong2");

    const prompt = "@nodeagent I'm Alan Zong at UpScaleX. My partner Mark Liu and I are evaluating an AI robotics company — Daxo (AI dexterous robotic hands, founded by Tom Zhang from Cornell + UPenn PhD in robotics, also in our portfolio). I want a side-by-side investment thesis comparison:\n1. My thesis: AI robotics + Alibaba's manufacturing/automation network synergy\n2. Mark's thesis: applied AI discipline — unit economics, path to profitability, comparable exits\nResearch the AI dexterous robotics market, key players (Ambi Robotics, Covariant, Symbotic), recent M&A activity, and build a spreadsheet with: Thesis Dimension, Alan's View, Mark's View, Market Evidence.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Daxo|robotics|thesis|Alan|Mark|Ambi|Covariant|Symbotic|M&A|manufacturing/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("Alan researches cross-border e-commerce AI for UpScaleX thesis validation", async ({ page }) => {
    test.setTimeout(240_000);
    const code = `ACE${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "AlanZong3");

    const prompt = "@nodeagent research the cross-border e-commerce AI market — specifically companies using AI for factory matching, supply chain optimization, and global brand scaling. This is core to UpScaleX's thesis (we backed Sourcy.ai for supply chain and Dimension Studios for TikTok Shop scaling). Find:\n1. Market size for AI in cross-border e-commerce\n2. Key competitors (Flexport, Sourcify, Alibaba's 1688 AI tools)\n3. Recent funding in this sub-sector\n4. How Alibaba's international expansion strategy intersects\nBuild a market map spreadsheet.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 240_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/cross-border|e-commerce|AI|supply chain|Flexport|Alibaba|factory|sourcing/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
  });
});

// ─── Persona 10: Second-Degree Connection — referral diligence ─────────────

test.describe("Second-Degree Connection — referral deal flow via Mark's network", () => {
  // Someone in Mark's network (e.g., a former PE colleague) refers a startup.
  // They create a NodeRoom to share with Mark for async review.

  test("Mark's former PE colleague refers a startup and creates a diligence room", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `REF${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveBlankRoom(page, "PEColleague");

    const prompt = "@nodeagent I'm a former colleague of Mark Liu from his private equity days. I'm referring a startup to UpScaleX: an AI-powered post-purchase advertising network focused on health & wellness brands (similar to UpScaleX's portfolio company in that space). Research:\n1. The post-purchase advertising market size and growth\n2. Health & wellness e-commerce trends\n3. Competitors in SKU-based advertising matching\n4. Why this fits UpScaleX's AI + commerce thesis\nBuild a referral diligence spreadsheet with: Aspect, Finding, Source, Fit Score (1-5) so Mark can quickly review.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/advertising|post-purchase|health|wellness|e-commerce|UpScaleX|referral|diligence/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });

    // Open trace details
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });

  test("second-degree connection does independent research on BeFreed before intro to Mark", async ({ page }) => {
    test.setTimeout(240_000);
    const code = `SDB${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "Connector2");

    const prompt = "@nodeagent I'm considering introducing a founder to Mark Liu at UpScaleX. The founder's company is BeFreed — an AI audio agent for personalized learning, founded by Jisong L. (ex-Pinterest and Google AI engineer), with 200K+ organic users and $100K ARR in 6 weeks. Before I make the intro, I want to research:\n1. BeFreed's current product (world's first audio agent for learning), traction, and user growth\n2. The AI audio learning market (competitors like Speechify, ElevenLabs, Audm)\n3. Whether BeFreed has raised funding or is raising\n4. How it fits UpScaleX's AI applications thesis\nBuild a pre-intro diligence spreadsheet so I can make a warm introduction with context.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 240_000);

    // Verify text output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/BeFreed|audio|learning|Pinterest|Google|Speechify|ElevenLabs|UpScaleX|intro/i, { timeout: 30_000 });

    // Verify spreadsheet
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
  });
});

// ─── Loop Engineering Recovery — agent handles a failed tool call ─────────────

test.describe("Loop Engineering — recovery from failure", () => {
  test("agent recovers when a tool returns no results and tries an alternative", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `HKL${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "LoopTester");

    // Ask about an obscure company — agent may need to retry with different search strategies
    const prompt = "@nodeagent research a company called 'Zyxel Semiconductor' — find their revenue, funding, and key products. If you can't find info with one search method, try another approach.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    // Wait for completion or blocked status (agent should at least attempt recovery)
    await expect(publicChat(page).getByTestId("job-status")).toContainText(/completed|blocked|failed/i, { timeout: 300_000 });

    // If completed, verify the agent either found info or reported it couldn't find enough
    const statusText = await publicChat(page).getByTestId("job-status").textContent();
    if (statusText?.includes("completed")) {
      await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Zyxel|not enough|could not find|limited/i, { timeout: 30_000 });
    }

    // Open trace details — should show multiple tool calls (recovery attempt)
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });
});

// ─── Persona 11: Blueberry (Nima Mozhgani) — commerce agent diligence ────────

test.describe("Blueberry — commerce agent startup research", () => {
  // Blueberry: world's first commerce agent that sells for you via social DMs.
  // Founder: Nima Mozhgani (ex-Snapchat). 10M social interactions processed,
  // driving millions in sales for global brands. Backed by UpScaleX.

  test("research Blueberry's commerce agent product and competitive landscape", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `BBY${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "NimaMozhgani");

    const prompt = "@nodeagent research Blueberry — a commerce agent startup that sells through social DMs at scale, founded by Nima Mozhgani (ex-Snapchat). They've processed 10M+ social interactions and drive millions in sales for global brands. Find:\n1. Their product (AI agent for Instagram/X/TikTok DMs that converts followers to customers)\n2. Competitors in social commerce automation (Manychat, Chatfuel, Intercom Fin)\n3. The social commerce market size and growth rate\n4. How Blueberry differentiates with agentic AI vs rule-based chatbots\nBuild a competitive analysis spreadsheet with: Company, Product, Approach (Rule-based vs Agentic), Funding, Key Customers.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Blueberry|commerce|social|DM|agent|Nima|Snapchat/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });

    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });
});

// ─── Persona 12: Expertise AI (Hao Sheng) — AI sales assistant traction ──────

test.describe("Expertise AI — AI sales assistant and booking platform", () => {
  // Expertise AI: AI assistant for account executives, Gen UI for B2B sales.
  // Founder: Hao Sheng (ex-Google, ex-Cresta). $500K→$1M ARR with 15%+ MoM growth.
  // #1 on HubSpot Marketplace with 300+ customers. Launched Expertise Booking.

  test("research Expertise AI's Gen UI product and HubSpot Marketplace traction", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `EXP${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "HaoSheng");

    const prompt = "@nodeagent research Expertise AI — an AI sales assistant startup founded by Hao Sheng (ex-Google, ex-Cresta). They build Gen UI for B2B sales and launched Expertise Booking (AI-powered calendar with pre-sales research). Key metrics: $1M ARR, 15%+ MoM growth, #1 on HubSpot Marketplace with 300+ customers. Find:\n1. Their product (Gen UI vs conversational UI for sales)\n2. HubSpot Marketplace ecosystem size and dynamics\n3. Competitors (Gong, Apollo, Outreach, Salesloft)\n4. The B2B sales AI market size\nBuild a spreadsheet with: Company, Product, AI Approach, Funding, ARR, Key Differentiator.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Expertise|sales|Gen UI|HubSpot|booking|Hao|Google|Cresta/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });
});

// ─── Persona 13: Sentrial (Neel Sharma) — YC W26 agent reliability ───────────

test.describe("Sentrial — AI agent reliability testing (YC W26)", () => {
  // Sentrial: production agent reliability — testing/eval for AI agents in production.
  // Founder: Neel Sharma. YC W26. Spoke at UpScaleX Agentic AI Founders' Night Out.

  test("research Sentrial's agent testing product and YC W26 cohort context", async ({ page }) => {
    test.setTimeout(240_000);
    const code = `SNT${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "NeelSharma");

    const prompt = "@nodeagent research Sentrial — a YC W26 startup building production agent reliability testing and evaluation. Founded by Neel Sharma. They help teams test and monitor AI agents in production. Find:\n1. Their product (agent testing, eval pipelines, production monitoring)\n2. YC W26 cohort context and what other agent infrastructure companies are in it\n3. Competitors in AI agent testing (LangSmith, Braintrust, Galileo, Patron)\n4. The AI agent testing/eval market size\nBuild a spreadsheet with: Company, Product, Testing Approach, Funding, YC Batch.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 240_000);

    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Sentrial|agent|reliability|testing|eval|YC|W26|Neel|Sharma/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
  });
});

// ─── Persona 14: AdsGency AI (Bolbi Liu) — $0→$10M ARR ad optimization ────────

test.describe("AdsGency AI — ad optimization platform rapid growth", () => {
  // AdsGency AI: ad optimization platform. Founder Bolbi Liu (ex-AWS).
  // $0→$10M ARR in 10 months, managing ~$100M in ad spend.
  // Sponsors UpScaleX events. Part of UpScaleX portfolio.

  test("research AdsGency AI's rapid growth and ad optimization market", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `ADG${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "BolbiLiu");

    const prompt = "@nodeagent research AdsGency AI — an ad optimization platform founded by Bolbi Liu (ex-AWS). They went from $0 to $10M ARR in 10 months and manage ~$100M in ad spend. Find:\n1. Their product (AI-powered ad optimization, what channels they support)\n2. How they achieved $10M ARR in 10 months (growth strategy, customer acquisition)\n3. Competitors (Smartly.io, Albert AI, Skai, AdRoll)\n4. The AI ad optimization market size and growth rate\n5. Any news about funding rounds or strategic partnerships\nBuild a growth analysis spreadsheet with: Metric, Value, Timeline, Source.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/AdsGency|ad|optimization|ARR|\$10M|Bolbi|AWS|spend/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });

    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });
});

// ─── Persona 15: Dimension Studios (Ali Mirzaei) — TikTok Shop AI ────────────

test.describe("Dimension Studios — AI OS for TikTok Shop", () => {
  // Dimension Studios: AI operating system for TikTok Shop — social commerce infrastructure.
  // Founder: Ali Mirzaei. Eight-figure exit at 18. 600M+ views generated.
  // Sponsored UpScaleX Anti-Shark Tank at NY Tech Week.

  test("research Dimension Studios TikTok Shop AI and social commerce market", async ({ page }) => {
    test.setTimeout(240_000);
    const code = `DIM${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "AliMirzaei");

    const prompt = "@nodeagent research Dimension Studios — an AI operating system for TikTok Shop founded by Ali Mirzaei (eight-figure exit at 18, 600M+ views generated). They build social commerce infrastructure. Find:\n1. Their product (AI agent for TikTok Shop sellers — listing, pricing, content)\n2. TikTok Shop market size, seller count, GMV growth\n3. Competitors in TikTok Shop enablement (Pipiads, Kalodata, FastMoss)\n4. The broader social commerce market trajectory\nBuild a spreadsheet with: Metric, Value, Source, Date.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 240_000);

    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Dimension|TikTok|Shop|social|commerce|Ali|Mirzaei|views/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
  });
});

// ─── Persona 16: UpScaleX Event Ecosystem Mapping ─────────────────────────────

test.describe("UpScaleX Event Ecosystem — community engagement mapping", () => {
  // UpScaleX runs a vibrant event ecosystem. Verified events from LinkedIn:
  //   Agentic AI Founders' Night Out (3 editions, SF), Founders' Day 2026 (24h, 20 founders, 60+ VCs),
  //   NY Tech Week Anti-Shark Tank (Room 52 comedy club, 9 founders), AI for Real Life Pitch Night,
  //   Beats & Build hackathon (with Second Axis), Agentic Commerce 101 (with Corgi Labs),
  //   Stripe Sessions 2026, CES After Party, SF Tech Week (2 events, 180+ people),
  //   LA Tech Week (60+ entrepreneurs), TechCrunch Disrupt side event (500+ attendees)

  test("map UpScaleX event ecosystem and portfolio company showcase history", async ({ page }) => {
    test.setTimeout(360_000);
    const code = `EVT${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveBlankRoom(page, "EventMapper");

    const prompt = "@nodeagent research UpScaleX's event ecosystem. They run events across SF, LA, and NY. Find details about:\n1. Agentic AI Founders' Night Out — 3 editions in SF, speakers include Neel Sharma (Sentrial YC W26), Bolbi Liu (AdsGency), Hao Sheng (Expertise AI), Gary Qi (TRAE/ByteDance)\n2. Founders' Day 2026 — 24-hour event with 20 ecosystem founders and 60+ VC investors, speakers: Hans Tung (Notable Capital), Maria Zhang (Palona AI)\n3. NY Tech Week Anti-Shark Tank at Room 52 comedy club — 9 founders pitched stand-up style\n4. Beats & Build hackathon with Second Axis — 8 teams, 10 hours, distribution as eval criteria\n5. AI for Real Life Pitch Night — 11 founders, NewsBreak ad impressions as prize\nBuild an event tracking spreadsheet with: Event Name, Date, Location, Attendees, Portfolio Companies Showcased, Key Speakers.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 360_000);

    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/event|UpScaleX|Founders|Agentic|Anti-Shark|hackathon|pitch|Tech Week/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r3__A"]').first()).toBeVisible({ timeout: 30_000 });
  });
});

// ─── Persona 17: Agentic Commerce Thesis Validation ───────────────────────────

test.describe("Agentic Commerce Thesis — UpScaleX investment thesis deep dive", () => {
  // UpScaleX's core thesis: Agentic AI + Digital Commerce.
  // McKinsey forecasts $1T agentic commerce by 2030.
  // Key shifts: discovery moves upstream to AI interfaces, GEO becomes new SEO,
  // trust/identity/permissions become infrastructure.
  // Portfolio proof points: Blueberry (commerce agent), Corgi Labs + Kite (payments rails),
  // Dimension Studios (TikTok Shop), MAI Agents (marketing agent), Pinpoint (commerce infra).

  test("validate UpScaleX agentic commerce thesis with market data and portfolio evidence", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `AGC${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "ThesisValidator");

    const prompt = "@nodeagent research and validate the agentic commerce investment thesis. UpScaleX (Palo Alto seed fund) backs this thesis with portfolio companies including Blueberry (commerce agent), Corgi Labs + Kite (agentic payments), Dimension Studios (TikTok Shop AI), and MAI Agents (marketing agent). Find:\n1. McKinsey's $1T agentic commerce forecast by 2030 — methodology and assumptions\n2. GEO (Generative Engine Optimization) as the new SEO — GPT-driven traffic conversion rates\n3. Trust/identity/permissions infrastructure for AI agents transacting on behalf of users\n4. Stripe Sessions 2026 insights on agentic commerce payment rails\n5. How UpScaleX's portfolio maps to each layer of the agentic commerce stack\nBuild a thesis validation spreadsheet with: Thesis Component, Market Evidence, Portfolio Proof Point, Confidence Level (1-5).";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/agentic|commerce|thesis|\$1T|McKinsey|GEO|Stripe|trust|identity|portfolio/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });

    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });
});

// ─── Persona 18: LinkedIn Deep Dive Workflow — the meta capability ───────────

test.describe("LinkedIn Deep Dive — investor research workflow via NodeAgent", () => {
  // This test simulates what a user would ask in NodeRoom chat:
  // "Deep dive into UpScaleX's LinkedIn presence — extract all posts, portfolio
  // companies, events, and key personnel insights."
  // The agent should use you_search + you_research to gather LinkedIn-sourced
  // data and synthesize a structured research output.
  // This is the workflow that was manually performed to gather the verified data
  // used throughout this test file. The goal is to make it a one-prompt capability.

  test("user asks for a full LinkedIn deep dive on UpScaleX in one prompt", async ({ page }) => {
    test.setTimeout(360_000);
    const code = `LDD${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveBlankRoom(page, "Researcher");

    const prompt = "@nodeagent do a comprehensive deep dive on UpScaleX (Palo Alto seed fund focused on Agentic AI and Digital Commerce). Research:\n1. Their LinkedIn company page (linkedin.com/company/upscalex) — extract all posts about portfolio companies, events, and investment thesis\n2. Key personnel: Alan Zong (Co-Founder & Partner, ex-Alibaba Innovation Investment), Mark Liu (Investor & Sector Lead AI)\n3. All portfolio companies with founders, products, and traction metrics\n4. Their event ecosystem (Agentic AI Founders' Night Out, Founders' Day, Anti-Shark Tank, Beats & Build hackathon)\n5. Their published investment thesis on Agentic Commerce ($1T by 2030, GEO as new SEO)\nUse you_search and you_research to gather data. Build a master spreadsheet with: Category, Entity, Key Facts, Source, Date.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 360_000);

    // Verify the agent produced a comprehensive research output
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/UpScaleX|portfolio|Agentic|event|Alan|Zong|Mark|Liu|thesis|commerce/i, { timeout: 30_000 });

    // Verify a master spreadsheet was created
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r3__A"]').first()).toBeVisible({ timeout: 30_000 });

    // Open trace details — should show multiple tool calls for comprehensive research
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });

  test("user asks for LinkedIn deep dive on a specific portfolio company — Blueberry", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `LDB${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "Researcher2");

    const prompt = "@nodeagent do a deep dive on Blueberry — an UpScaleX portfolio company that builds commerce agents for social DMs. Research:\n1. Their LinkedIn presence and posts about product launches, traction updates\n2. Founder Nima Mozhgani's background (ex-Snapchat) and LinkedIn activity\n3. UpScaleX's posts about Blueberry (10M social interactions, millions in sales for global brands)\n4. Competitors in social commerce automation\n5. Customer testimonials and case studies\nUse you_search to find LinkedIn posts and web content. Build a company profile spreadsheet with: Dimension, Finding, Source, Confidence.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Blueberry|commerce|agent|social|Nima|Snapchat|DM|UpScaleX/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });
});

// ─── Persona 19: What NodeRoom Offers — capability mapping for UpScaleX ──────

test.describe("What NodeRoom Offers — capability mapping for VC fund", () => {
  // This test maps what NodeRoom can do for a VC fund like UpScaleX,
  // based on all discovered workflows from the LinkedIn deep dive.

  test("VC partner asks NodeRoom to build a portfolio tracker with all 17+ companies", async ({ page }) => {
    test.setTimeout(360_000);
    const code = `NRO${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveBlankRoom(page, "MarkLiu8");

    const prompt = "@nodeagent build a portfolio tracker spreadsheet for UpScaleX with all known portfolio companies. Include columns: Company, Founder, Product, Sector, Funding Stage, Key Metric, Investment Thesis Fit. Here are the verified companies:\n1. MAI Agents — Yuchen W. — AI performance marketing — $25M seed (Kleiner Perkins)\n2. Blueberry — Nima Mozhgani — commerce agent for social DMs — 10M interactions\n3. Expertise AI — Hao Sheng — AI sales assistant + booking — $1M ARR\n4. BeFreed — Jisong L. — audio agent for learning — $100K ARR, 200K users\n5. Dex — Reni Cao — AI learning camera for kids — dex.camera\n6. Dimension Studios — Ali Mirzaei — AI OS for TikTok Shop — 600M views\n7. Make the Dot — Emilie H. — AI fashion design\n8. Daxo — Tom Zhang — dexterous robotic hands — Cornell/UPenn PhD\n9. Sentrial — Neel Sharma — agent reliability testing — YC W26\n10. AdsGency AI — Bolbi Liu — ad optimization — $10M ARR\n11. Curator — Adam Morgan — AI ops platform JARVIS\n12. Sourcy — Karl Chan — supply chain/sourcing\n13. Midas Touch — Cordelia Xiao — consumer commerce — Stanford GSB MBA\n14. WorkDuo AI — Fiona Lau — agentic commerce — 9-figure exit\n15. Corgi Labs — Saif Farooqui — agentic commerce payments\n16. Kite — Chi Zhang — agentic commerce payments\n17. ShiptAI — Richard Rabbat — shipping/logistics AI\nUse you_search to verify and enrich each entry. Fill the spreadsheet.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 360_000);

    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/portfolio|tracker|MAI|Blueberry|Expertise|BeFreed|Dex|Daxo|Sentrial|AdsGency/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r5__A"]').first()).toBeVisible({ timeout: 30_000 });

    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });

  test("VC partner asks NodeRoom to map founder network across portfolio for co-investment opportunities", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `NRF${Date.now().toString(36).toUpperCase()}`;

    await openFreshLiveDemoRoom(page, code, "MarkLiu9");

    const prompt = "@nodeagent map the founder network across UpScaleX's portfolio. Research these founders and find connections (shared prior employers, alumni networks, co-investments):\n1. Yuchen W. (MAI Agents) — ex-Google Ads, ex-Instacart VP\n2. Nima Mozhgani (Blueberry) — ex-Snapchat\n3. Hao Sheng (Expertise AI) — ex-Google, ex-Cresta\n4. Jisong L. (BeFreed) — ex-Pinterest, ex-Google AI\n5. Reni Cao (Dex) — consumer tech PM\n6. Ali Mirzaei (Dimension Studios) — eight-figure exit at 18\n7. Cordelia Xiao (Midas Touch) — ex-AliExpress Europe, Stanford GSB MBA\n8. Fiona Lau (WorkDuo AI) — ex-Shopline, 9-figure exit\n9. Bolbi Liu (AdsGency AI) — ex-AWS\nBuild a network map spreadsheet with: Founder, Company, Prior Employer, Alumni Network, Potential Connections to Other Portfolio Founders.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);

    await waitForAgentCompletion(page, 300_000);

    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/founder|network|Google|Snapchat|Instacart|Pinterest|Stanford|connection|portfolio/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("research Maverick — UpScaleX portfolio company mentioned in LinkedIn posts", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `MVK${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "MarkLiu9");
    const prompt = "@nodeagent research Maverick — a company mentioned in UpScaleX's LinkedIn posts. Find:\n1. What Maverick does (product, sector)\n2. Who founded it\n3. Any funding or traction metrics\n4. Their relationship to UpScaleX (portfolio company, ecosystem partner, or event participant)\nIf information is limited, note what you could find and what's unverified. Build a research spreadsheet with: Entity, Key Facts, Source, Verification Status.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Maverick|research|company|UpScaleX|portfolio|not found|limited/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("research Second Axis — co-hosted Beats & Build hackathon with UpScaleX", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `SAX${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "MarkLiu9");
    const prompt = "@nodeagent research Second Axis — a company that co-hosted the Beats & Build hackathon with UpScaleX. The hackathon had 8 teams building AI agents in 10 hours with distribution as the evaluation metric. Find:\n1. What Second Axis does (product, sector)\n2. Who founded it\n3. Their relationship to UpScaleX (co-host, ecosystem partner)\n4. Any other events or collaborations with UpScaleX\nBuild a research spreadsheet with: Entity, Key Facts, Source, Verification Status.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Second Axis|hackathon|Beats|Build|UpScaleX|co-host|research/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("research Retriever AI (Arjun Chintapalli) — mentioned in UpScaleX LinkedIn posts", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `RTV${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "MarkLiu9");
    const prompt = "@nodeagent research Retriever AI, founded by Arjun Chintapalli. This company was mentioned in UpScaleX's LinkedIn posts. Find:\n1. What Retriever AI does (product, sector, AI agent category)\n2. Arjun Chintapalli's background (prior employers, education)\n3. Any funding, traction, or product launches\n4. Their relationship to UpScaleX (portfolio, ecosystem, event participant)\nBuild a research spreadsheet with: Entity, Key Facts, Source, Verification Status.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Retriever|Arjun|Chintapalli|AI|research|UpScaleX/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("research DSALTA (Jon Can Ozdoruk) — mentioned in UpScaleX LinkedIn posts", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `DSL${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "MarkLiu9");
    const prompt = "@nodeagent research DSALTA, founded by Jon Can Ozdoruk. This company was mentioned in UpScaleX's LinkedIn posts. Find:\n1. What DSALTA does (product, sector)\n2. Jon Can Ozdoruk's background\n3. Any funding, traction, or product details\n4. Their relationship to UpScaleX\nBuild a research spreadsheet with: Entity, Key Facts, Source, Verification Status.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/DSALTA|Jon|Ozdoruk|research|UpScaleX/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("research AllNutrition (Alireza Faghaninia) — mentioned in UpScaleX LinkedIn posts", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `NUT${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "MarkLiu9");
    const prompt = "@nodeagent research AllNutrition, founded by Alireza Faghaninia. This company was mentioned in UpScaleX's LinkedIn posts. Find:\n1. What AllNutrition does (product, sector — likely health/nutrition AI)\n2. Alireza Faghaninia's background\n3. Any funding, traction, or product details\n4. Their relationship to UpScaleX\nBuild a research spreadsheet with: Entity, Key Facts, Source, Verification Status.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/AllNutrition|Alireza|Faghaninia|nutrition|research|UpScaleX/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("research Hirey AI (Walter Wu) — mentioned in UpScaleX LinkedIn posts", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `HRY${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "MarkLiu9");
    const prompt = "@nodeagent research Hirey AI, founded by Walter Wu. This company was mentioned in UpScaleX's LinkedIn posts. Find:\n1. What Hirey AI does (product, sector — likely HR/hiring AI agent)\n2. Walter Wu's background\n3. Any funding, traction, or product details\n4. Their relationship to UpScaleX\nBuild a research spreadsheet with: Entity, Key Facts, Source, Verification Status.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Hirey|Walter|Wu|hiring|AI|research|UpScaleX/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("research Tioga (Jean-Nicolas Vollmer) — mentioned in UpScaleX LinkedIn posts", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `TGA${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "MarkLiu9");
    const prompt = "@nodeagent research Tioga, founded by Jean-Nicolas Vollmer. This company was mentioned in UpScaleX's LinkedIn posts. Find:\n1. What Tioga does (product, sector)\n2. Jean-Nicolas Vollmer's background\n3. Any funding, traction, or product details\n4. Their relationship to UpScaleX\nBuild a research spreadsheet with: Entity, Key Facts, Source, Verification Status.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Tioga|Jean|Nicolas|Vollmer|research|UpScaleX/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("research Pinpoint (Joshua Cohen) — commerce infrastructure startup in UpScaleX ecosystem", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `PNP${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "MarkLiu9");
    const prompt = "@nodeagent research Pinpoint, founded by Joshua Cohen. This is a commerce infrastructure startup mentioned in the UpScaleX ecosystem. Find:\n1. What Pinpoint does (product, sector — likely commerce/payment infrastructure)\n2. Joshua Cohen's background\n3. Any funding, traction, or product details\n4. Their relationship to UpScaleX (portfolio, ecosystem, event participant)\n5. Competitive landscape — who else does commerce infrastructure for AI agents?\nBuild a research spreadsheet with: Entity, Key Facts, Source, Verification Status.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Pinpoint|Joshua|Cohen|commerce|infrastructure|research|UpScaleX/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("research Keyan Li — UpScaleX Strategic Advisor and his portfolio involvement", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `KYL${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "AlanZong");
    const prompt = "@nodeagent research Keyan Li — listed as a Strategic Advisor at UpScaleX. Find:\n1. Keyan Li's background (prior employers, education, investment history)\n2. His role at UpScaleX (advisor, LP, co-investor?)\n3. Any other board seats or advisory roles\n4. His LinkedIn activity and investment thesis\n5. Connections to other UpScaleX portfolio companies or founders\nBuild a research spreadsheet with: Entity, Key Facts, Source, Verification Status.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Keyan|Li|advisor|UpScaleX|strategic|research/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("batch research all 8 gap companies discovered in UpScaleX LinkedIn posts", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `BGP${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "MarkLiu9");
    const prompt = "@nodeagent research these 8 companies that were mentioned in UpScaleX's LinkedIn posts but have limited public information. For each, find what they do, who founded them, and any traction metrics:\n1. Maverick\n2. Second Axis (co-hosted Beats & Build hackathon with UpScaleX)\n3. Retriever AI (Arjun Chintapalli)\n4. DSALTA (Jon Can Ozdoruk)\n5. AllNutrition (Alireza Faghaninia)\n6. Hirey AI (Walter Wu)\n7. Tioga (Jean-Nicolas Vollmer)\n8. Pinpoint (Joshua Cohen)\nBuild a spreadsheet with: Company, Founder, Product/Sector, Traction, UpScaleX Relationship, Source, Verification Status. Mark any unverified claims as needs_review.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Maverick|Second Axis|Retriever|DSALTA|AllNutrition|Hirey|Tioga|Pinpoint|research|portfolio|UpScaleX/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r8__A"]').first()).toBeVisible({ timeout: 60_000 });
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });

  // ─── Person Deep Dive tests (source-agnostic, MDX output) ───

  test("person deep dive — Nima Mozhgani (Blueberry founder)", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `PGH${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "MarkLiu9");
    const prompt = "@nodeagent do a deep dive on Nima Mozhgani (founder of Blueberry). Find everything you can about him — his background, career, projects, code, writing, talks, education, anything. Build a spreadsheet with: Category, Entity, Key Facts, Source, Date. Then write an MDX-formatted profile to the wiki with sections for whatever dimensions you found evidence for.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Nima|Mozhgani|Blueberry|profile|research/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("person deep dive — Hao Sheng (Expertise AI founder)", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `PAP${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "AlanZong");
    const prompt = "@nodeagent research Hao Sheng (founder of Expertise AI). Find everything — background, career, publications, code, projects, talks, education, press, anything you can discover. Build a spreadsheet with Category, Entity, Key Facts, Source, Date. Write an MDX profile to the wiki with sections for whatever you found.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Hao|Sheng|Expertise|profile|research/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("person deep dive — Jisong L. (BeFreed, ex-Pinterest/Google AI)", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `PCR${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "MarkLiu9");
    const prompt = "@nodeagent build a comprehensive profile on Jisong L. (founder of BeFreed, previously at Pinterest and Google AI). Find everything you can — career, education, code, papers, projects, talks, press, community, anything. Build a spreadsheet and write an MDX profile to the wiki with sections for whatever dimensions you found evidence for.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Jisong|BeFreed|Pinterest|Google|profile|research/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("person deep dive — Arjun Chintapalli (Retriever AI founder)", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `PEV${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "AlanZong");
    const prompt = "@nodeagent research Arjun Chintapalli (founder of Retriever AI). Find everything — background, career, education, code, projects, events, press, community, anything you can discover. Build a spreadsheet with Category, Entity, Key Facts, Source, Date. Write an MDX profile to the wiki.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Arjun|Chintapalli|Retriever|profile|research/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("person deep dive — Yuchen W. (MAI Agents, MDX output verification)", async ({ page }) => {
    test.setTimeout(300_000);
    const code = `PMD${Date.now().toString(36).toUpperCase()}`;
    await openFreshLiveDemoRoom(page, code, "MarkLiu9");
    const prompt = "@nodeagent do a deep dive on Yuchen W. (founder of MAI Agents, raised $25M from Kleiner Perkins). Find everything you can about him — any dimension that exists. Build a spreadsheet AND write an MDX-formatted profile to the wiki. The MDX should have sections only for dimensions where you found evidence.";
    await sendAgentMessage(page, prompt);
    await waitForAgentJobStarted(page);
    const stream = await waitForAgentStream(page);
    await waitForAgentCompletion(page, 300_000);
    await expect(stream.getByTestId("agent-stream-text").last()).toContainText(/Yuchen|MAI|Agents|profile|research/i, { timeout: 30_000 });
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
    const detail = await openJobDetails(page);
    await expect(detail).toContainText(/Tool calls/i);
  });
});
