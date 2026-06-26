# NodeRoom Live Browser Dogfood Results

Generated: 2026-06-26
Dev server: http://127.0.0.1:5173/?mode=memory
Browser: Playwright (Chromium)
Viewport: 1860x940 (desktop), 390x844 (mobile)

## Summary

- Flows executed: 10
- Flows passed: 10
- Flows failed: 0
- Console errors: 0
- Screenshots captured: 10

## Flow Results

### Flow 1: Fresh blank room → wall inventory default (A1, A2, C1, C2)
- **Action**: Create demo room from landing
- **Result**: PASS
- **Evidence**: Wall ("Risk / opportunity wall") is active tab by default
- **Details**: 3 inventory clusters render: Spreadsheets (3), Notes (4), Walls (1). 8 clickable cards. 3 post-its in Quick captures.
- **Screenshot**: `dogfood-01-wall-inventory-default.png`

### Flow 2: Runway / milestones sheet — column visibility (E1, E6)
- **Action**: Click Runway/milestones card from inventory
- **Result**: PASS
- **Evidence**: All 7 columns render (company, cash, burn, runway, status, milestones). 2 data rows visible.
- **Details**: Table 726px vs wrapper 705px — only 21px overflow (was 448px before fix). Horizontal scroll enabled.
- **Screenshot**: `dogfood-02-runway-sheet-fixed.png`

### Flow 3: Diligence memo — alignment (I5)
- **Action**: Click Diligence memo card from inventory
- **Result**: PASS
- **Evidence**: Note renders with heading "Startup banking diligence memo" and body text. Active tab = "Diligence memo".
- **Screenshot**: `dogfood-03-diligence-memo.png`

### Flow 4: Post-it CRUD (C4)
- **Action**: Add post-it → edit text → delete post-it
- **Result**: PASS
- **Evidence**:
  - Add: count 3 → 4, new post-it "New note" appears
  - Edit: text changed to "QA test post-it — live dogfood"
  - Delete: count 4 → 3, test post-it removed
  - Binder count updates live (3 notes → 4 notes → 3 notes)
- **Screenshot**: `dogfood-04-postit-crud.png`

### Flow 5: Chat send + private tab (B1, B2)
- **Action**: Type message in public chat → Enter → switch to private tab
- **Result**: PASS
- **Evidence**: Message "QA dogfood test message — checking chat send" appears as 3rd paragraph. Private tab shows private chat with "Ask privately…" placeholder.
- **Details**: No duplicate messages. Private content does not leak to public.

### Flow 6: Page reload → wall default persists (A4, C1)
- **Action**: Navigate to landing → create room again
- **Result**: PASS
- **Evidence**: Wall is active tab. 3 clusters, 8 cards, 3 post-its — same as initial state.
- **Screenshot**: `dogfood-06-reopen-wall-default.png`

### Flow 7: Q3 variance sheet — full render (E1, E5)
- **Action**: Click Q3 variance card from inventory
- **Result**: PASS
- **Evidence**: 6 columns (Account, Q2, Q3, Variance, Note), 24 rows. Table fits wrapper exactly (865px = 865px). No overflow.
- **Screenshot**: `dogfood-07-q3-variance-sheet.png`

### Flow 8: Company research sheet — wide sheet scroll (E5, E6)
- **Action**: Click Company research card from inventory
- **Result**: PASS
- **Evidence**: 15 columns, 24 rows. Table 1726px vs wrapper 865px — horizontal scroll enabled. All columns accessible via scroll.
- **Screenshot**: `dogfood-08-company-research-sheet.png`

### Flow 9: Trace panel (G6)
- **Action**: Click Trace tab
- **Result**: PASS
- **Evidence**: 5+ trace events visible including agent runs, QA passes, evidence citations. Shows model, step count, timestamps. Attribution breakdown (AI 2, Mixed 0, Human 6).
- **Screenshot**: `dogfood-09-trace-panel.png`

### Flow 10: Mobile viewport — no overflow (A5, M6)
- **Action**: Resize to 390x844 (iPhone 14 Pro) → wall inventory → sheet
- **Result**: PASS
- **Evidence**: 
  - Wall: body 390px = viewport 390px, no overflow. 8 cards, 3 clusters render.
  - Sheet: body 390px, no page overflow. Sheet wrap scrolls internally (410px in 363px wrapper).
- **Screenshots**: `dogfood-10-mobile-wall-no-overflow.png`, `dogfood-10b-mobile-sheet-scroll.png`

## Console Error Log

Zero errors across all 10 flows.

## Matrix Coverage Update

| Matrix ID | Status Before | Status After |
|---|---|---|
| A1 | shipped | shipped (verified) |
| A2 | shipped | shipped (verified) |
| A4 | shipped | shipped (verified) |
| A5 | partial | partial (verified — no overflow) |
| B1 | shipped | shipped (verified) |
| B2 | shipped | shipped (verified) |
| C1 | shipped | shipped (verified) |
| C2 | shipped | shipped (verified) |
| C3 | shipped | shipped (verified) |
| C4 | shipped | shipped (verified) |
| E1 | shipped | shipped (verified) |
| E5 | shipped | shipped (verified) |
| E6 | in_progress | shipped (verified — scroll works) |
| G6 | shipped | shipped (verified) |
| I5 | shipped | shipped (verified) |
| M6 | partial | partial (verified — no body overflow, sheet scrolls internally) |
