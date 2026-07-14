import type { ReactElement } from "react";
import { ExternalLink, GitBranch, X } from "lucide-react";
import type { SemanticGraphSelection } from "./semanticGraphTypes";
import { semanticNodePrimaryAction } from "./semanticGraphSelectors";

interface EntityGraphDetailPanelProps {
  selection: SemanticGraphSelection;
  onClose: () => void;
  onOpenArtifact: (artifactId: string, elementId?: string) => void;
}

const kindLabel = (kind: string): string => kind.replace(/_/g, " ");

export function EntityGraphDetailPanel({ selection, onClose, onOpenArtifact }: EntityGraphDetailPanelProps): ReactElement | null {
  const selected = selection.selected;
  const selectedEdge = selection.selectedEdge;
  if (!selected && !selectedEdge) return null;
  const primaryAction = selected ? semanticNodePrimaryAction(selected) : null;
  const sourceRef = selected?.refs.find((ref) => ref.sourceUrl);

  return (
    <aside className="r-entity-detail" data-testid="entity-graph-detail" aria-label="Entity graph detail">
      <div className="r-entity-detail-head">
        <div className="r-entity-detail-title">
          <GitBranch size={13} />
          <span>{selected?.label ?? selectedEdge?.label}</span>
        </div>
        <button type="button" className="r-entity-detail-close" onClick={onClose} aria-label="Close entity detail">
          <X size={14} />
        </button>
      </div>

      <div className="r-entity-detail-meta">
        {selected && <span>{kindLabel(selected.kind)}</span>}
        {selectedEdge && <span>{kindLabel(selectedEdge.kind)}</span>}
        <span>{selected?.status ?? selectedEdge?.status}</span>
        {selected?.refs[0]?.artifactTitle && <span>{selected.refs[0].artifactTitle}</span>}
      </div>

      {(primaryAction || sourceRef?.sourceUrl) && (
        <div className="r-entity-detail-actions">
          {primaryAction?.artifactId && (
            <button type="button" onClick={() => onOpenArtifact(primaryAction.artifactId!, primaryAction.elementId)}>
              {primaryAction.label}
            </button>
          )}
          {sourceRef?.sourceUrl && (
            <a href={sourceRef.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> Source
            </a>
          )}
        </div>
      )}

      <div className="r-entity-detail-sections">
        {!!selection.paths?.length && (
          <section className="r-entity-detail-section" data-testid="entity-graph-paths">
            <h3>Relevant Paths</h3>
            {selection.paths.map((path) => {
              const artifactRef = path.refs.find((ref) => ref.artifactId);
              return (
                <button
                  key={path.id}
                  type="button"
                  className="r-entity-detail-row r-entity-detail-path"
                  onClick={() => { if (artifactRef?.artifactId) onOpenArtifact(artifactRef.artifactId, artifactRef.elementId); }}
                  disabled={!artifactRef?.artifactId}
                >
                  <span className="r-entity-detail-row-main">{path.label}</span>
                  <span className="r-entity-detail-row-sub">{path.edgeIds.length} hop{path.edgeIds.length === 1 ? "" : "s"} - {path.status}</span>
                </button>
              );
            })}
          </section>
        )}
        {selection.sections.map((item) => (
          <section key={item.id} className="r-entity-detail-section">
            <h3>{item.label}</h3>
            {item.nodes.map((node) => {
              const action = semanticNodePrimaryAction(node);
              return (
                <button
                  key={node.id}
                  type="button"
                  className="r-entity-detail-row"
                  onClick={() => { if (action?.artifactId) onOpenArtifact(action.artifactId, action.elementId); }}
                  disabled={!action?.artifactId}
                >
                  <span className="r-entity-detail-row-main">{node.label}</span>
                  <span className="r-entity-detail-row-sub">{kindLabel(node.kind)} - {node.status}</span>
                </button>
              );
            })}
            {[...new Map(item.edges.map((edge) => [`${edge.kind}:${edge.label}`, edge])).values()].slice(0, 4).map((edge) => (
              <div key={edge.id} className="r-entity-detail-edge">
                <span>{edge.label}</span>
                <span>{kindLabel(edge.kind)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
