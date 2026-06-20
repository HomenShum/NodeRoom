import { useMemo, useState, type FormEvent } from "react";
import { Bot, CheckCircle2, Send, Table2 } from "lucide-react";
import { buildStoryAgentTurn, type StoryAgentTurn } from "./storyQuickDemoModel";

const BASE_ROWS = [
  { label: "Revenue", q2: "10,000", q3: "12,400" },
  { label: "COGS", q2: "4,000", q3: "5,100" },
  { label: "Gross profit", q2: "6,000", q3: "7,300" },
  { label: "OpEx", q2: "2,200", q3: "2,650" },
];

export function StoryQuickDemo() {
  const [q3Revenue, setQ3Revenue] = useState("12,400");
  const [prompt, setPrompt] = useState("Check C2 and commit the variance note");
  const [turns, setTurns] = useState<StoryAgentTurn[]>([]);
  const latest = turns.at(-1);
  const draft = useMemo(() => buildStoryAgentTurn(prompt, q3Revenue), [prompt, q3Revenue]);
  const variance = latest?.variance ?? draft.variance;
  const note = latest?.note ?? "local edit";

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const turn = buildStoryAgentTurn(prompt, q3Revenue);
    setTurns((cur) => [...cur.slice(-2), turn]);
    setPrompt("");
  };

  return (
    <section className="rs-quick" aria-label="Interactive story demo">
      <div className="rs-quick-head">
        <span className="r-eyebrow"><Table2 size={13} /> Try the room in 20 seconds</span>
        <h2 className="rs-quick-title">Edit the cell. Ask the agent. Watch the commit stay narrow.</h2>
      </div>

      <div className="rs-quick-grid">
        <div className="rs-demo-sheet" aria-label="Editable Q3 revenue demo spreadsheet">
          <div className="rs-demo-sheetbar">
            <span className="rs-mock-mark">N</span>
            <b>Q3 Model.xlsx</b>
            <span className="rs-mock-sync">local demo</span>
          </div>
          <table className="rs-demo-grid">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Q2</th>
                <th scope="col">Q3</th>
                <th scope="col">Variance</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Revenue</th>
                <td>10,000</td>
                <td className="rs-demo-edit">
                  <input
                    value={q3Revenue}
                    onChange={(event) => setQ3Revenue(event.target.value)}
                    aria-label="Q3 revenue cell C2"
                  />
                </td>
                <td className="rs-demo-formula" data-testid="story-variance-cell">{variance}</td>
                <td className="rs-demo-note">{note}</td>
              </tr>
              {BASE_ROWS.slice(1).map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{row.q2}</td>
                  <td>{row.q3}</td>
                  <td>{row.label === "Gross profit" ? "1,300" : row.label === "OpEx" ? "450" : "1,100"}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rs-demo-trace">
            <span><CheckCircle2 size={12} /> local paint</span>
            <span><CheckCircle2 size={12} /> CAS check</span>
            <span><CheckCircle2 size={12} /> trace ready</span>
          </div>
        </div>

        <div className="rs-demo-chat" aria-label="Interactive story agent chat">
          <div className="rs-demo-chat-head">
            <span className="r-avatar agent sm">N</span>
            <b>Room NodeAgent</b>
            <span className="r-tag agent">demo</span>
          </div>

          <div className="rs-demo-feed" aria-live="polite">
            {turns.length === 0 ? (
              <div className="rs-demo-empty">
                <Bot size={16} />
                <span>Change C2, then send the prompt.</span>
              </div>
            ) : turns.map((turn, index) => (
              <div className="rs-demo-turn" key={`${turn.prompt}-${index}`}>
                <div className="rs-demo-human">{turn.prompt}</div>
                <div className="rs-demo-agent">
                  {turn.steps.map((step) => <span key={step}>{step}</span>)}
                  <b>{turn.finalText}</b>
                </div>
              </div>
            ))}
          </div>

          <form className="rs-demo-composer" onSubmit={submit}>
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask NodeAgent..."
              aria-label="Story agent prompt"
            />
            <button type="submit" className="r-send" data-testid="story-agent-send" aria-label="Run story agent">
              <Send size={15} />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
