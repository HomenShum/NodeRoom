import { useEffect, useState } from "react";
import { BookOpen, Database, File, FileCode2, FlaskConical, NotebookPen, Sparkles, Table2, X, type LucideIcon } from "lucide-react";
import type { ArtifactKind } from "../../contract.js";
import type { FileContent } from "../../api.js";
import type { WorkerClient } from "../client.js";
import type { ArtifactView } from "../eventReducer.js";
import { Markdown } from "./Markdown.js";

const ICONS: Record<ArtifactKind, LucideIcon> = {
  table: Table2,
  notebook: NotebookPen,
  code: FileCode2,
  test: FlaskConical,
  doc: BookOpen,
  skill: Sparkles,
  data: Database,
  other: File,
};

export function Artifacts(props: { artifacts: ArtifactView[]; client: WorkerClient; projectId?: string; selected?: string; onSelect(path: string | undefined): void }) {
  const items = props.artifacts.slice().reverse();
  return (
    <section className="naw-panel naw-artifacts" data-testid="naw-artifacts" aria-label="Artifacts">
      <div className="naw-section-title">Artifacts in this run</div>
      {items.length === 0 ? <p className="naw-muted naw-small">No workspace files written in this run.</p> : null}
      <ul className="naw-list">
        {items.map((a) => {
          const Icon = ICONS[a.kind] ?? File;
          return (
            <li key={a.path}>
              <button
                type="button"
                className="naw-list-btn naw-artifact"
                data-testid="naw-artifact-item"
                data-path={a.path}
                data-kind={a.kind}
                aria-current={props.selected === a.path || undefined}
                disabled={a.change === "deleted"}
                onClick={() => props.onSelect(a.path)}
              >
                <span className="naw-row">
                  <Icon size={14} aria-hidden />
                  <span className="naw-ellipsis">{a.path}</span>
                </span>
                <span className="naw-muted naw-small">
                  {a.change} · {a.bytes.toLocaleString()} B{a.writes > 1 ? ` · ${a.writes} writes` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {props.selected && props.projectId ? <ArtifactViewer client={props.client} projectId={props.projectId} path={props.selected} onClose={() => props.onSelect(undefined)} /> : null}
    </section>
  );
}

function ArtifactViewer({ client, projectId, path, onClose }: { client: WorkerClient; projectId: string; path: string; onClose(): void }) {
  const [state, setState] = useState<{ file?: FileContent; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    setState({});
    client.file(projectId, path).then(
      (file) => !cancelled && setState({ file }),
      (err: Error) => !cancelled && setState({ error: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, projectId, path]);

  return (
    <div className="naw-viewer" data-testid="naw-artifact-viewer" role="region" aria-label={`Viewer: ${path}`}>
      <div className="naw-viewer-head">
        <code className="naw-ellipsis">{path}</code>
        <button type="button" className="naw-icon-btn" onClick={onClose} aria-label="Close viewer">
          <X size={14} aria-hidden />
        </button>
      </div>
      {state.error ? <p className="naw-error naw-small">{state.error}</p> : null}
      {!state.file && !state.error ? <p className="naw-muted naw-small">Loading…</p> : null}
      {state.file ? (
        <>
          {state.file.truncated ? <p className="naw-muted naw-small">Showing the first part of a {state.file.bytes.toLocaleString()} byte file.</p> : null}
          <FileBody path={path} text={state.file.text} truncated={state.file.truncated} />
        </>
      ) : null}
    </div>
  );
}

function FileBody({ path, text, truncated }: { path: string; text: string; truncated: boolean }) {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return <Markdown text={text} className="naw-viewer-md" />;
  if ((ext === "json" || ext === "ipynb") && !truncated) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return <pre className="naw-pre naw-viewer-pre">{text}</pre>;
    }
    if (ext === "ipynb" && data && typeof data === "object" && Array.isArray((data as { cells?: unknown }).cells)) {
      const cells = (data as { cells: Array<{ cell_type?: string; source?: string | string[] }> }).cells;
      return (
        <ol className="naw-cells">
          {cells.map((c, i) => {
            const src = Array.isArray(c.source) ? c.source.join("") : c.source ?? "";
            return (
              <li key={i} data-cell-type={c.cell_type}>
                <div className="naw-label">
                  [{i + 1}] {c.cell_type ?? "cell"}
                </div>
                {c.cell_type === "markdown" ? <Markdown text={src} /> : <pre className="naw-pre">{src}</pre>}
              </li>
            );
          })}
        </ol>
      );
    }
    return <pre className="naw-pre naw-viewer-pre">{JSON.stringify(data, null, 2)}</pre>;
  }
  return <pre className="naw-pre naw-viewer-pre naw-mono">{text}</pre>;
}
