/* ============================================================================
   NodeAgent Room Tour — App controller (screen routing, top bar, walkthrough
   dock). Ported from room/app.jsx (window.RTour). The designer-only tweaks
   panel + frame_a/b/c.js direction iframes are intentionally omitted — only
   the user-facing theme toggle + autoAllow switch are kept.
   ============================================================================ */
import * as React from "react";
import "./roomTour.css";
import { Ico } from "./RoomTourIcons";
import { Avatar, Landing, CreateModal, JoinModal } from "./RoomTourFlows";
import { RoomShell, type OpenPanels } from "./RoomTourShell";
import { STEPS, PEOPLE, makeRoomCode, type Step, type PanelId } from "./roomTourData";

const IDX: Record<string, number> = {};
STEPS.forEach((s, i) => { IDX[s.id] = i; });

function TopAvatars(): React.ReactElement {
  const list = [PEOPLE.homen, PEOPLE.priya, PEOPLE.quokka, PEOPLE.room_na];
  return (
    <div className="rt-avatars">
      {list.map((p) => (
        <span
          key={p.id}
          className={"rt-av" + (p.kind === "agent" ? " agent" : "")}
          style={{ background: p.color }}
          title={p.name + " · " + p.role}
        >
          {p.short}
          {p.kind === "human" ? <span className="pulse" /> : null}
        </span>
      ))}
    </div>
  );
}

function Dock({
  stepIdx,
  setStep,
}: {
  stepIdx: number;
  setStep: (i: number) => void;
}): React.ReactElement {
  const s: Step = STEPS[stepIdx];
  return (
    <div className="rt-dock">
      <div className="rt-stepdots">
        {STEPS.map((st, i) => (
          <button
            key={st.id}
            className="rt-stepdot"
            data-state={i === stepIdx ? "active" : i < stepIdx ? "done" : "todo"}
            title={st.label}
            onClick={() => setStep(i)}
          />
        ))}
      </div>
      <div className="rt-dock-nav">
        <button
          className="rt-iconbtn"
          disabled={stepIdx === 0}
          onClick={() => setStep(stepIdx - 1)}
          aria-label="Previous step"
        >
          {Ico("arrowL", { size: 17 })}
        </button>
        <button
          className="rt-iconbtn"
          disabled={stepIdx === STEPS.length - 1}
          onClick={() => setStep(stepIdx + 1)}
          aria-label="Next step"
        >
          {Ico("arrow", { size: 17 })}
        </button>
      </div>
      <div className="rt-dock-step" style={{ flex: "none", width: 168 }}>
        <div className="ds-kicker">{s.kicker}</div>
        <div className="ds-title">{s.title}</div>
      </div>
      <div className="rt-dock-blurb grow">{s.blurb}</div>
      <div className="rt-dock-file">
        {Ico("code", { size: 12, className: "gi" })}
        {s.file}
      </div>
    </div>
  );
}

export function RoomTour(): React.ReactElement {
  const [dark, setDark] = React.useState(true); // dark-first, matches the prototype default
  const [stepIdx, setStepIdx] = React.useState(0);
  const [roomCode, setRoomCode] = React.useState<string>(() => makeRoomCode());
  const [roomTitle, setRoomTitle] = React.useState("Q3 diligence");
  const [joinCode, setJoinCode] = React.useState("");
  const [openPanels, setOpenPanels] = React.useState<OpenPanels>({ left: false, artifact: false, right: false });
  const [autoAllow, setAutoAllow] = React.useState(true);

  const step: Step = STEPS[stepIdx];
  const inRoom = step.screen === "room";

  // Sync panels to the step's declared layout whenever the step changes.
  React.useEffect(() => {
    if (step.panels) {
      const panels: PanelId[] = step.panels;
      setOpenPanels({
        left:     panels.includes("left"),
        artifact: panels.includes("artifact"),
        right:    panels.includes("right"),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx]);

  const setStep = (i: number): void => setStepIdx(Math.max(0, Math.min(STEPS.length - 1, i)));
  const togglePanel = (k: keyof OpenPanels): void =>
    setOpenPanels((o) => ({ ...o, [k]: !o[k] }));

  const goCreate = (): void => setStep(IDX.create);
  const goJoin = (code: string): void => {
    setJoinCode((code || "").trim() || "Q3X-7K");
    setStep(IDX.join);
  };
  const enterFromCreate = (code: string, title: string): void => {
    setRoomCode(code);
    setRoomTitle(title);
    setStep(IDX.chat);
  };
  const enterFromJoin = (): void => {
    if (joinCode) setRoomCode(joinCode);
    setStep(IDX.chat);
  };

  return (
    <div className="rt-app" data-theme={dark ? "dark" : "light"}>
      <div className="rt-top">
        <div className="rt-mark">N</div>
        <div className="rt-brand">
          NodeAgent
          {inRoom ? <span>{"  ·  " + roomTitle}</span> : null}
        </div>
        {inRoom ? (
          <span className="rt-roomcode">
            {Ico("link", { size: 13 })}code <b>{roomCode}</b>
          </span>
        ) : null}
        <span className="rt-spacer" />
        {inRoom ? (
          <div className="rt-toggle-group">
            <button className="rt-iconbtn" data-on={String(openPanels.left)} title="Files & people" onClick={() => togglePanel("left")}>{Ico("panelL", { size: 16 })}</button>
            <button className="rt-iconbtn" data-on={String(openPanels.artifact)} title="Artifact" onClick={() => togglePanel("artifact")}>{Ico("sheet", { size: 16 })}</button>
            <button className="rt-iconbtn" data-on={String(openPanels.right)} title="Your private agent" onClick={() => togglePanel("right")}>{Ico("panelR", { size: 16 })}</button>
          </div>
        ) : null}
        {inRoom ? (
          <button className="rt-pill-auto" onClick={() => setAutoAllow((v) => !v)} title="Auto-approve agent edits">
            Auto-allow
            <span className="rt-switch" data-on={String(autoAllow)} />
          </button>
        ) : null}
        {inRoom ? <TopAvatars /> : null}
        <button className="rt-iconbtn" title="Toggle theme" onClick={() => setDark((v) => !v)}>
          {Ico(dark ? "sun" : "moon", { size: 17 })}
        </button>
      </div>

      {/* ── screen ── */}
      {inRoom ? (
        <RoomShell step={step} openPanels={openPanels} autoAllow={autoAllow} />
      ) : (
        <>
          <Landing onCreate={goCreate} onJoin={goJoin} />
          {step.screen === "create" ? <CreateModal onClose={() => setStep(IDX.landing)} onEnter={enterFromCreate} /> : null}
          {step.screen === "join"   ? <JoinModal code={joinCode || "Q3X-7K"} onClose={() => setStep(IDX.landing)} onEnter={enterFromJoin} /> : null}
        </>
      )}

      {/* ── walkthrough dock ── */}
      <Dock stepIdx={stepIdx} setStep={setStep} />
    </div>
  );
}

// Avatar re-exported so future external Tour embeds can reuse it without
// reaching into RoomTourFlows directly.
export { Avatar };
