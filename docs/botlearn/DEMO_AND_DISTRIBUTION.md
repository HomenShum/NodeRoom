# PowerPoint skill — demo script + distribution plan

The leaderboard is won on **field notes (×20)**, not raw installs. So this doc has two jobs: (1) a 90-second live demo that makes a VC *get it*, and (2) a distribution loop that turns installs into field notes.

---

## 90-second demo script (the OneNote story → live run)

**Lead with the lived pain — it's your unfair advantage.**

> **0:00 — Hook.** "When I was an associate, the first thing I opened every morning was OneNote. That was my real operating system — messy notes from founder calls and conferences. The hard part was never *writing* them. It was turning them into something I could put in front of a senior or a client and *defend* — without accidentally inventing a number."

> **0:20 — The trap.** "Every AI deck tool I tried would smooth over the gaps. No funding amount in my notes? It'd invent a plausible one. In finance, that's not a convenience — it's a fireable mistake."

> **0:35 — Live run.** Paste the messy CardioNova notes. Run the skill. "I didn't answer any questions. It read my notes, built the deck, and ran an honesty gate."

> **0:50 — Show the deck.** Flip through:
> - the verified product claim — *with a source footer*;
> - the Series B line — marked **⚠ needs review**, because I only wrote "maybe raising";
> - the runway slide — it says **`[TK: verify months of runway]`** in amber. It did **not** invent "18 months."
> - the final slide: **"To Verify Before Presenting"** — the exact two things I'd be bluffing about.

> **1:15 — The line.** "It built the deck *and* told me what I'd be lying about if I presented it as-is. That's the difference between a demo and a tool you'd put your name on."

> **1:25 — Close.** "It's on SkillHunt. One dependency, no backend — it runs in your agent on your own notes right now."

**Demo prep checklist**
- [ ] `pip install python-pptx` on the demo machine beforehand.
- [ ] Pre-open `assets/examples/cardionova_notes.md` and a terminal in the skill dir.
- [ ] Have `deck.pptx` from a dry run ready as a fallback if live render is slow.
- [ ] Open the rendered deck in PowerPoint/LibreOffice so the amber `⚠`/`[TK]` markers are visible on screen.

---

## Distribution loop (install → real task → field note)

The ×20 weight means **one real user running it on their own notes** beats 20 cold installs. Target people who live the pain:

1. **Solo founders / indie hackers** — they pitch constantly and fear the made-up-number moment.
2. **Anyone doing diligence or research** — analysts, scouts, BD.
3. The Bay Area builder room at the event itself — get ≥1 install + run on the day (clears the "actually runs" eligibility gate immediately).

**The share message (short, concrete, honest):**
> Built an "honest deck builder" Agent Skill: paste your messy notes → real .pptx, but it flags every fact it can't source instead of inventing one. Curious what it catches in *your* notes — install on SkillHunt and run the eval prompt, takes 2 min.

**The field-note prompt to hand them** (also in the skill README):
```
Install and use the "powerpoint" skill on my real notes below. Draft a deck plan,
run the evidence gate, render the .pptx, and then tell me: how many claims came out
verified vs. manual vs. needs_review, and what specifically I need to verify before
I present this. Notes:
<paste your messy notes here>
```

**Why this converts to a field note:** the "what you need to verify" output is a genuine *aha* — users want to report "it caught X that I would have presented as fact." Make that the thing you ask them to mention.

---

## Eligibility checklist (do not get DQ'd)
- [x] Targets a real OPC scenario (solo founder → investor/update deck).
- [x] Actually runs — produces a real `.pptx` (verified end-to-end).
- [x] Not a no-op — the evidence gate + provenance rendering change agent behavior measurably.
- [x] Original — provenance governance on top of generation; not a copy of any GitHub/Clawhub skill.
- [ ] Published on SkillHunt with README + scenario description. *(README ready in the skill dir.)*
- [ ] Installed + run by ≥1 other registered BotLearn user.
- [ ] Submitted before **Jun 27, 12:00 PM PT**.
