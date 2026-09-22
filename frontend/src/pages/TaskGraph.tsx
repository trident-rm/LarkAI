import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import type { PageProps, Task } from "../types";
import { Badge, LinkOut } from "../components";
import { formatDate } from "../api";
import { usePreferences } from "../preferences";
import {
  dependencies,
  parents,
  graphIndex,
  graphScope,
  graphLayout,
  isBlocked,
} from "../taskGraph";

type Props = {
  tasks: Task[];
  visibleTasks: Task[];
  hiddenTaskIds: Set<string>;
  selected?: string;
  select: (id: string) => void;
  busy: boolean;
  mutate: PageProps["mutate"];
};
export function TaskGraph({
  tasks,
  visibleTasks,
  hiddenTaskIds,
  selected,
  select,
  busy,
  mutate,
}: Props) {
  const { t, locale } = usePreferences();
  const index = useMemo(() => graphIndex(tasks), [tasks]);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [upstream, setUpstream] = useState(false);
  const [downstream, setDownstream] = useState(false);
  const [showHierarchy, setShowHierarchy] = useState(true);
  const [all, setAll] = useState(false);
  const [zoom, setZoom] = useState(0.85);
  const [editing, setEditing] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const task =
    (hiddenTaskIds.has(selected ?? "")
      ? undefined
      : index.byId.get(selected ?? "")) ?? visibleTasks[0];
  const scope = useMemo(() => {
    const result = graphScope(
      tasks,
      task?.id ?? "",
      upstream,
      downstream,
      all,
      showHierarchy,
    );
    for (const id of hiddenTaskIds) result.delete(id);
    return result;
  }, [
    tasks,
    task?.id,
    upstream,
    downstream,
    all,
    showHierarchy,
    hiddenTaskIds,
  ]);
  const layout = useMemo(
    () => graphLayout(tasks, scope, showHierarchy),
    [tasks, scope, showHierarchy],
  );
  useLayoutEffect(() => {
    const node = layout.nodes.find((node) => node.id === task?.id);
    const element = viewport.current;
    if (node && element)
      element.scrollTo({
        left: Math.max(0, (node.x + 111) * zoom - element.clientWidth / 2),
        top: Math.max(0, (node.y + 50) * zoom - element.clientHeight / 2),
      });
  }, [task?.id, layout, zoom]);
  const positions = new Map(layout.nodes.map((node) => [node.id, node]));
  function choose(id: string) {
    select(id);
    setEditing(false);
  }
  const visible = new Set(visibleTasks.map((t) => t.id));
  // Keep ancestors visible when filtering; the graph always includes linked context.
  for (const candidate of visibleTasks) {
    const pending = [...parents(candidate)];
    const visited = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      visible.add(id);
      pending.push(...(index.byId.get(id)?.parent_ids ?? []));
    }
  }
  for (const id of hiddenTaskIds) visible.delete(id);
  const rendered = new Set<string>();
  function tree(id: string, depth = 0): React.ReactNode {
    if (rendered.has(id) || !visible.has(id)) return null;
    rendered.add(id);
    const item = index.byId.get(id);
    if (!item) return null;
    const children = (index.children.get(id) ?? []).filter((child) =>
      visible.has(child),
    );
    // Mark collapsed descendants visited so they aren't emitted as orphan roots.
    if (collapsed.has(id)) {
      const pending = [...children];
      while (pending.length) {
        const child = pending.pop()!;
        if (rendered.has(child)) continue;
        rendered.add(child);
        pending.push(...(index.children.get(child) ?? []));
      }
    }
    return (
      <div key={id}>
        <div
          className={`tree-row ${task?.id === id ? "selected" : ""}`}
          style={{ paddingLeft: Math.min(depth, 6) * 14 + 6 }}
        >
          <button
            className="tree-toggle"
            aria-label={t(
              collapsed.has(id) ? "Expand {title}" : "Collapse {title}",
              { title: item.title },
            )}
            disabled={!children.length}
            aria-expanded={children.length ? !collapsed.has(id) : undefined}
            onClick={() =>
              setCollapsed((previous) => {
                const next = new Set(previous);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          >
            {children.length ? (
              collapsed.has(id) ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronDown size={14} />
              )
            ) : (
              <span />
            )}
          </button>
          <button
            className="tree-task"
            aria-label={item.title}
            onClick={() => choose(id)}
            aria-pressed={task?.id === id}
            title={item.title}
          >
            <span className={`task-dot ${item.status}`} />
            <span>{item.title}</span>
            {isBlocked(item, index.byId) && (
              <span className="blocked-dot" title={t("Blocked")}>
                •
              </span>
            )}
          </button>
        </div>
        {!collapsed.has(id) && children.map((child) => tree(child, depth + 1))}
      </div>
    );
  }
  const roots = tasks
    .filter((item) => !parents(item).some((id) => index.byId.has(id)))
    .map((item) => tree(item.id));
  const leftovers = tasks.map((item) => tree(item.id));
  const crumbs: Task[] = [];
  if (task) {
    const seen = new Set([task.id]);
    let parent = parents(task)[0];
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = index.byId.get(parent);
      if (!ancestor) break;
      if (!hiddenTaskIds.has(ancestor.id)) crumbs.unshift(ancestor);
      parent = parents(ancestor)[0];
    }
  }
  function links(ids: string[]) {
    ids = ids.filter((id) => !hiddenTaskIds.has(id));
    return ids.length ? (
      <ul className="relationship-list">
        {ids.map((id) => (
          <li key={id}>
            {index.byId.has(id) ? (
              <button onClick={() => choose(id)}>
                {index.byId.get(id)!.title}
                <Badge value={index.byId.get(id)!.status} />
              </button>
            ) : (
              <span>
                {t("Unavailable task")} · {id.split(":").at(-1)}
              </span>
            )}
          </li>
        ))}
      </ul>
    ) : (
      <p className="graph-muted">{t("None")}</p>
    );
  }
  const cycleIds = [
    ...new Set([...index.cycles, ...index.hierarchyCycles]),
  ].filter((id) => !hiddenTaskIds.has(id));
  return (
    <>
      {cycleIds.length > 0 && (
        <div className="graph-warning" role="alert">
          {t(
            "Cycles detected. Review the highlighted tasks; these relationships are not a DAG.",
          )}{" "}
          {cycleIds.map((id) => (
            <button key={id} onClick={() => choose(id)}>
              {index.byId.get(id)?.title}
            </button>
          ))}
        </div>
      )}
      <div className="task-workspace">
        <aside className="task-tree" aria-label={t("Task hierarchy")}>
          <div className="graph-panel-heading">
            <GitBranch size={17} />
            <strong>{t("Task hierarchy")}</strong>
            <span className="count">{visibleTasks.length}</span>
          </div>
          <div className="tree-scroll">
            {roots}
            {leftovers}
            {!visibleTasks.length && (
              <p className="graph-muted">{t("No tasks match.")}</p>
            )}
          </div>
        </aside>
        <section
          className="dependency-canvas"
          aria-label={t("Dependency graph")}
        >
          <div className="graph-panel-heading">
            <strong>{t("Dependency graph")}</strong>
            <span className="graph-muted">
              {scope.size} {t("nodes")}
            </span>
          </div>
          <div className="graph-controls">
            <label>
              <input
                type="checkbox"
                checked={showHierarchy}
                onChange={(e) => setShowHierarchy(e.target.checked)}
              />
              {t("Show hierarchy")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={upstream}
                onChange={(e) => setUpstream(e.target.checked)}
                disabled={all}
              />
              {t("Expand upstream")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={downstream}
                onChange={(e) => setDownstream(e.target.checked)}
                disabled={all}
              />
              {t("Expand downstream")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={all}
                onChange={(e) => setAll(e.target.checked)}
              />
              {t("Entire graph")}
            </label>
          </div>
          <div className="graph-caption graph-legend">
            <span>
              <i className="legend-dependency" />
              {t("Prerequisite → dependant")}
            </span>
            {showHierarchy && (
              <span>
                <i className="legend-hierarchy" />
                {t("Parent → subtask")}
              </span>
            )}
          </div>
          <div className="graph-viewport" ref={viewport}>
            <div
              style={{
                width: layout.width * zoom,
                height: layout.height * zoom,
                position: "relative",
              }}
            >
              <div
                className="graph-world"
                style={{
                  width: layout.width,
                  height: layout.height,
                  transform: `scale(${zoom})`,
                }}
              >
                <svg
                  width={layout.width}
                  height={layout.height}
                  className="graph-edges"
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="dependency-arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                    </marker>
                    <marker
                      id="hierarchy-arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path
                        d="M 1 1 L 9 5 L 1 9"
                        fill="none"
                        stroke="var(--accent-text-2)"
                        strokeWidth="1.5"
                      />
                    </marker>
                  </defs>
                  {layout.edges.map(({ from, to, kind }) => {
                    const a = positions.get(from)!;
                    const b = positions.get(to)!;
                    const x = a.x + 222,
                      y = a.y + (kind === "hierarchy" ? 76 : 40),
                      x2 = b.x,
                      y2 = b.y + (kind === "hierarchy" ? 76 : 40);
                    const bend = Math.max(35, Math.abs(x2 - x) / 2);
                    return (
                      <path
                        key={`${kind}-${from}-${to}`}
                        data-relationship={kind}
                        className={
                          kind === "hierarchy"
                            ? "hierarchy-edge"
                            : index.cycles.has(from) && index.cycles.has(to)
                              ? "cycle-edge"
                              : ""
                        }
                        d={`M${x},${y} C${x + bend},${y} ${x2 - bend},${y2} ${x2},${y2}`}
                        markerEnd={
                          kind === "hierarchy"
                            ? "url(#hierarchy-arrow)"
                            : "url(#dependency-arrow)"
                        }
                      />
                    );
                  })}
                </svg>
                {layout.nodes.map((node) => {
                  const item = index.byId.get(node.id);
                  const blocked = item && isBlocked(item, index.byId);
                  return (
                    <button
                      key={node.id}
                      disabled={!item}
                      onClick={() => choose(node.id)}
                      className={`graph-node ${node.id === task?.id ? "selected" : ""} ${index.cycles.has(node.id) || index.hierarchyCycles.has(node.id) ? "cycle-node" : ""}`}
                      style={{ left: node.x, top: node.y }}
                      aria-pressed={node.id === task?.id}
                      aria-label={t("Explore {title}", {
                        title: item?.title ?? node.id,
                      })}
                    >
                      <span className="graph-node-title">
                        {item?.title ?? t("Unavailable task")}
                      </span>
                      <span className="graph-node-meta">
                        {item ? (
                          <>
                            <span className={`task-dot ${item.status}`} />
                            {t(item.status)}
                            {blocked && (
                              <span className="blocked-label">
                                {t("Blocked")}
                              </span>
                            )}
                          </>
                        ) : (
                          node.id.split(":").at(-1)
                        )}
                      </span>
                      <span className="graph-node-owner">
                        {item?.owners.map((m) => m.name || m.email || m.id).join(", ") ||
                          t("Unassigned")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            {!task && (
              <p className="graph-muted">
                {t("Select a task to explore its dependencies.")}
              </p>
            )}
          </div>
          <div className="graph-footer">
            <span>
              {t(
                "Linked tasks remain visible unless completed or cancelled tasks are hidden.",
              )}
            </span>
            <div>
              <button
                aria-label={t("Zoom out")}
                onClick={() => setZoom(Math.max(0.25, zoom - 0.15))}
              >
                <ZoomOut size={16} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                aria-label={t("Zoom in")}
                onClick={() => setZoom(Math.min(1.8, zoom + 0.15))}
              >
                <ZoomIn size={16} />
              </button>
              <button
                aria-label={t("Fit graph")}
                onClick={() => {
                  setZoom(
                    Math.max(
                      0.1,
                      Math.min(
                        1,
                        (viewport.current?.clientWidth ?? 600) / layout.width,
                        (viewport.current?.clientHeight ?? 450) / layout.height,
                      ),
                    ),
                  );
                  viewport.current?.scrollTo(0, 0);
                }}
              >
                <Maximize2 size={16} />
              </button>
            </div>
          </div>
        </section>
        <aside className="task-detail" aria-label={t("Task details")}>
          {task ? (
            <>
              <div className="task-breadcrumb">
                {crumbs.map((ancestor) => (
                  <button key={ancestor.id} onClick={() => choose(ancestor.id)}>
                    {ancestor.title} /
                  </button>
                ))}
              </div>
              <div className="card-meta">
                <Badge value={task.status} />
                <Badge value={task.priority} />
                <LinkOut url={task.url} />
              </div>
              <h2>{task.title}</h2>
              {isBlocked(task, index.byId) && (
                <p className="blocked-label">
                  {t("Blocked by unfinished prerequisites")}
                </p>
              )}
              <p className="task-detail-description">
                {task.description || t("No description")}
              </p>
              <dl>
                <dt>{t("Owner")}</dt>
                <dd>
                  {task.owners.map((m) => m.name || m.email || m.id).join(", ") ||
                    t("Unassigned")}
                </dd>
                <dt>{t("Due date")}</dt>
                <dd>{formatDate(task.due, locale)}</dd>
              </dl>
              <h3>{t("Parent task")}</h3>
              {links(parents(task))}
              <h3>{t("Subtasks")}</h3>
              {links(index.children.get(task.id) ?? [])}
              <h3>{t("Prerequisites")}</h3>
              {links(dependencies(task))}
              <h3>{t("Dependants")}</h3>
              {links(index.downstream.get(task.id) ?? [])}
              {["bitable", "mock"].includes(task.source) && (
                <button
                  className="primary"
                  onClick={() => setEditing(!editing)}
                >
                  {t(editing ? "Close editor" : "Edit relationships")}
                </button>
              )}
              {editing && (
                <RelationshipEditor
                  key={task.id}
                  task={task}
                  tasks={tasks}
                  busy={busy}
                  mutate={mutate}
                  done={() => setEditing(false)}
                />
              )}
            </>
          ) : (
            <p className="graph-muted">
              {t("Select a task to explore its dependencies.")}
            </p>
          )}
        </aside>
      </div>
    </>
  );
}

function RelationshipEditor({
  task,
  tasks,
  busy,
  mutate,
  done,
}: {
  task: Task;
  tasks: Task[];
  busy: boolean;
  mutate: PageProps["mutate"];
  done: () => void;
}) {
  const { t } = usePreferences();
  const [parent, setParent] = useState(parents(task)[0] ?? "");
  const [ids, setIds] = useState(dependencies(task));
  const [expected] = useState({
    expected_parent_ids: parents(task),
    expected_dependency_ids: dependencies(task),
  });
  const [query, setQuery] = useState("");
  const candidates = tasks.filter(
    (candidate) =>
      candidate.id !== task.id &&
      candidate.source === task.source &&
      candidate.table_id === task.table_id,
  );
  const missing = ids.filter(
    (id) => !candidates.some((candidate) => candidate.id === id),
  );
  return (
    <form
      className="relationship-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await mutate(`/tasks/${encodeURIComponent(task.id)}/relationships`, {
            parent_ids: parent ? [parent] : [],
            dependency_ids: ids,
            ...expected,
          })
        )
          done();
      }}
    >
      <label>
        {t("Parent task")}
        <select value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">{t("None")}</option>
          {parent && !candidates.some((c) => c.id === parent) && (
            <option value={parent}>
              {t("Unavailable task")} {parent}
            </option>
          )}
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Find prerequisites")}
        <span className="search">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
      </label>
      <fieldset>
        <legend>
          {t("Prerequisites")} ({ids.length})
        </legend>
        <div className="dependency-picker">
          {[
            ...missing.map((id) => ({
              id,
              title: `${t("Unavailable task")} ${id}`,
            })),
            ...candidates.filter((candidate) =>
              candidate.title.toLowerCase().includes(query.toLowerCase()),
            ),
          ].map((candidate) => (
            <label key={candidate.id}>
              <input
                type="checkbox"
                checked={ids.includes(candidate.id)}
                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, candidate.id]
                      : ids.filter((id) => id !== candidate.id),
                  )
                }
              />
              {candidate.title}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="graph-muted">
        {t(
          task.source === "mock"
            ? "Changes stay in this demo. Cycles are rejected. Parent tasks do not imply dependencies."
            : "Changes are saved to Feishu. Cycles are rejected. Parent tasks do not imply dependencies.",
        )}
      </p>
      <button className="primary" disabled={busy}>
        {t("Save relationships")}
      </button>
    </form>
  );
}
