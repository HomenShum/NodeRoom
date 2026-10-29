import { useState } from "react";
import { SendHorizontal } from "lucide-react";
import type { EngineId } from "../../contract.js";
import type { HealthResponse } from "../../api.js";
import type { TemplateSummary } from "../client.js";

export function Composer(props: {
  health: HealthResponse;
  engineId: EngineId | "";
  onEngine(id: EngineId): void;
  model: string;
  onModel(m: string): void;
  tasks: NonNullable<TemplateSummary["suggestedTasks"]>;
  /** Text shown on the send button's title: where the message will go. */
  target: string;
  disabledReason?: string;
  onSend(text: string): Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const engine = props.health.engines.find((e) => e.descriptor.id === props.engineId);
  const blocked = props.disabledReason ?? (engine && !engine.availability.ok ? "This engine needs setup" : undefined);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || blocked) return;
    setSending(true);
    try {
      if (await props.onSend(text)) setDraft("");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="naw-composer-wrap" aria-label="Composer">
      {engine && !engine.availability.ok ? (
        <div className="naw-setup" data-testid="naw-setup-required" role="alert">
          <strong>Setup required for {engine.descriptor.label}</strong>
          <ul>
            {engine.availability.missing.length ? engine.availability.missing.map((m) => <li key={m}>{m}</li>) : <li>The worker reported this engine unavailable without details.</li>}
          </ul>
        </div>
      ) : null}
      {props.tasks.length ? (
        <div className="naw-suggestions" aria-label="Suggested tasks">
          {props.tasks.map((t) => (
            <button key={t.id} type="button" className="naw-chip naw-chip-btn" data-testid="naw-suggested-task" data-task-id={t.id} title={t.prompt} onClick={() => setDraft(t.prompt)}>
              {t.title}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        className="naw-input naw-textarea"
        data-testid="naw-composer"
        aria-label="Task for the agent"
        placeholder="Describe a task. Enter sends, Shift+Enter adds a line."
        value={draft}
        rows={3}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="naw-composer-bar">
        <select
          className="naw-input naw-input-sm"
          data-testid="naw-engine-select"
          aria-label="Engine"
          value={props.engineId}
          onChange={(e) => props.onEngine(e.target.value as EngineId)}
        >
          {props.health.engines.map(({ descriptor, availability }) => (
            <option key={descriptor.id} value={descriptor.id}>
              {descriptor.label}
              {availability.ok ? "" : " (setup required)"}
            </option>
          ))}
        </select>
        <input
          className="naw-input naw-input-sm naw-mono"
          data-testid="naw-model-input"
          aria-label="Model"
          list="naw-model-options"
          placeholder={engine ? `default: ${engine.descriptor.defaultModel}` : "model"}
          value={props.model}
          onChange={(e) => props.onModel(e.target.value)}
        />
        <datalist id="naw-model-options">
          {engine?.descriptor.models.map((m) => <option key={m} value={m} />)}
        </datalist>
        <span className="naw-muted naw-small naw-grow">{blocked ?? props.target}</span>
        <button type="button" className="naw-btn naw-btn-primary" data-testid="naw-send" onClick={() => void send()} disabled={!draft.trim() || sending || Boolean(blocked)} title={blocked ?? props.target}>
          <SendHorizontal size={14} aria-hidden /> {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </section>
  );
}
