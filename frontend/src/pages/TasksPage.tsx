import { usePreferences } from "../preferences";
import { useState } from "react";
import { useSearchParams, NavLink } from "react-router-dom";
import {
  activeTask,
  overdueTask,
  needsAttention,
  taskOrder,
} from "../taskView";
import {
  Plus,
  Search,
  Clock3,
  Users,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { Task, Member, PageProps, Session } from "../types";
import { useData } from "../useData";
import { formatDate } from "../api";
import { Heading, Load, Empty, Badge, LinkOut } from "../components";
import { TaskGraph } from "./TaskGraph";
import { graphIndex, isBlocked } from "../taskGraph";
import { TaskForm } from "./TaskForm";

export function TasksPage({
  session,
  revision,
  mutate,
  busy,
  personal = false,
}: PageProps & { personal?: boolean }) {
  const { t: translate } = usePreferences();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState(params.has("task") ? "graph" : "board");
  const [selected, setSelected] = useState<string | undefined>(
    params.get("task") || undefined,
  );
  const [division, setDivision] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [hideFinished, setHideFinished] = useState(personal);
  const [group, setGroup] = useState(personal ? "none" : "status");
  const [creating, setCreating] = useState(false);
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const state = useData<Task[]>("/tasks?q=&status=", revision, true);
  const members = useData<Member[]>(
    creating ? "/members" : undefined,
    revision,
  );
  const options = useData<{ categories: string[]; divisions: string[] }>(
    creating ? "/task-options" : undefined,
    revision,
  );
  const toggleCard = (id: string) =>
    setOpenCards((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleGroup = (key: string) =>
    setOpenGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const titleOf = (label: string) =>
    translate(label) === label ? label.replaceAll("_", " ") : translate(label);
  return (
    <>
      <Heading
        title={translate(personal ? "My Tasks" : "Team tasks")}
        description={translate(
          personal
            ? "Your assignments, priorities, and next steps."
            : "Find work across the team and see how it connects.",
        )}
      >
        <button className="primary" onClick={() => setCreating(!creating)}>
          <Plus size={17} />
          {creating ? translate("Close form") : translate("New task")}
        </button>
      </Heading>
      <Load state={state}>
        {(allTasks) => {
          const hiddenTaskIds = new Set(
            allTasks
              .filter(
                (task) =>
                  hideFinished &&
                  ["completed", "cancelled"].includes(task.status),
              )
              .map((task) => task.id),
          );
          const index = graphIndex(allTasks);
          const scoped = personal
            ? allTasks.filter(
                (task) =>
                  !!session.user?.open_id &&
                  task.owners.some(
                    (owner) => owner.id === session.user?.open_id,
                  ),
              )
            : allTasks;
          const tasks = scoped.filter(
            (task) =>
              !hiddenTaskIds.has(task.id) &&
              (!params.get("owner") ||
                task.owners.some(
                  (owner) => owner.id === params.get("owner"),
                )) &&
              needsAttention(task, params.get("attention") || "", index.byId) &&
              (!status || task.status === status) &&
              (!division || task.divisions.includes(division)) &&
              `${task.title} ${task.description}`
                .toLowerCase()
                .includes(q.toLowerCase()),
          );
          tasks.sort(taskOrder);
          const groups: Record<string, Task[]> = {};
          tasks.forEach((t) => {
            const key =
              group === "division"
                ? t.divisions.join(" · ") || "Unassigned division"
                : group === "source"
                  ? t.source
                  : group === "none"
                    ? "All tasks"
                    : t.status;
            (groups[key] ??= []).push(t);
          });
          return (
            <>
              <div className="work-summary">
                <div>
                  <strong>{scoped.filter(activeTask).length}</strong>
                  <span>{translate("Active tasks")}</span>
                </div>
                <div>
                  <strong>
                    {scoped.filter((task) => overdueTask(task)).length}
                  </strong>
                  <span>{translate("Overdue")}</span>
                </div>
                <div>
                  <strong>
                    {
                      scoped.filter((task) => isBlocked(task, index.byId))
                        .length
                    }
                  </strong>
                  <span>{translate("Blocked")}</span>
                </div>
                <NavLink to={personal ? "/tasks" : "/"}>
                  {translate(
                    personal ? "Browse team tasks" : "Back to my tasks",
                  )}{" "}
                  →
                </NavLink>
              </div>
              {creating && (
                <section className="panel">
                  <Load state={members}>
                    {(m) => (
                      <Load state={options}>
                        {(o) => (
                          <TaskForm
                            members={m}
                            options={o}
                            busy={busy}
                            submit={async (body) => {
                              const saved = await mutate("/tasks", body);
                              if (saved) setCreating(false);
                              return saved;
                            }}
                          />
                        )}
                      </Load>
                    )}
                  </Load>
                </section>
              )}
              <div
                className="task-view-switch"
                aria-label={translate("Task view")}
              >
                <button
                  aria-pressed={view === "board"}
                  onClick={() => setView("board")}
                >
                  {translate(personal ? "List" : "Board")}
                </button>
                <button
                  aria-pressed={view === "graph"}
                  onClick={() => setView("graph")}
                >
                  {translate("Graph")}
                </button>
              </div>
              {(params.has("attention") || params.has("owner")) && (
                <div className="notice">
                  {translate("Filtered from team overview")}{" "}
                  <button onClick={() => setParams({})}>
                    {translate("Clear filters")}
                  </button>
                </div>
              )}
              <div className="toolbar">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label={translate("Search tasks")}
                    placeholder={translate("Search tasks…")}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                <select
                  aria-label={translate("Filter status")}
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    if (["completed", "cancelled"].includes(e.target.value))
                      setHideFinished(false);
                  }}
                >
                  <option value="">{translate("All statuses")}</option>
                  {[
                    "pending",
                    "in_progress",
                    "completed",
                    "cancelled",
                    "paused",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {translate(s)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={translate("Filter team")}
                  value={division}
                  onChange={(e) => setDivision(e.target.value)}
                >
                  <option value="">{translate("All teams")}</option>
                  {[...new Set(allTasks.flatMap((task) => task.divisions))]
                    .sort()
                    .map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                </select>
                <label className="task-filter-toggle">
                  <input
                    type="checkbox"
                    checked={hideFinished}
                    onChange={(e) => {
                      setHideFinished(e.target.checked);
                      if (
                        e.target.checked &&
                        ["completed", "cancelled"].includes(status)
                      )
                        setStatus("");
                    }}
                  />
                  {translate("Hide completed and cancelled")}
                </label>
                {view === "board" && !personal && (
                  <select
                    aria-label={translate("Group tasks")}
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                  >
                    {["status", "division", "source", "none"].map((s) => (
                      <option key={s} value={s}>
                        {translate("Group:")} {translate(s)}
                      </option>
                    ))}
                  </select>
                )}
                {view === "board" && tasks.length > 0 && (
                  <>
                    <button
                      className="collapse-all"
                      onClick={() => {
                        setOpenGroups(new Set(Object.keys(groups)));
                        setOpenCards(new Set(tasks.map((t) => t.id)));
                      }}
                    >
                      {translate("Expand all")}
                    </button>
                    <button
                      className="collapse-all"
                      onClick={() => {
                        setOpenGroups(new Set());
                        setOpenCards(new Set());
                      }}
                    >
                      {translate("Collapse all")}
                    </button>
                  </>
                )}
              </div>
              {!tasks.length && (
                <Empty>
                  {translate(
                    personal
                      ? "No assignments match. Add a task for yourself or browse team tasks."
                      : "No tasks match. Create a task or sync Feishu to get started.",
                  )}
                </Empty>
              )}
              {view === "graph" ? (
                <TaskGraph
                  tasks={allTasks}
                  hiddenTaskIds={hiddenTaskIds}
                  visibleTasks={tasks}
                  selected={selected}
                  select={setSelected}
                  busy={busy}
                  mutate={mutate}
                />
              ) : (
                <div
                  className={
                    personal ? "task-groups personal-tasks" : "task-groups"
                  }
                >
                  {Object.entries(groups).map(([label, items]) => {
                    const groupOpen = openGroups.has(label);
                    const title = titleOf(label);
                    return (
                      <section className="task-group" key={label}>
                        <div
                          className="group-summary"
                          onClick={() => toggleGroup(label)}
                        >
                          <button
                            type="button"
                            className="card-toggle"
                            aria-expanded={groupOpen}
                            aria-label={translate(
                              groupOpen ? "Collapse {title}" : "Expand {title}",
                              { title },
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleGroup(label);
                            }}
                          >
                            {groupOpen ? (
                              <ChevronDown size={16} />
                            ) : (
                              <ChevronRight size={16} />
                            )}
                          </button>
                          <h2>
                            {title}{" "}
                            <span className="count">{items.length}</span>
                          </h2>
                        </div>
                        {groupOpen && (
                          <div className="task-group-body">
                            {items.map((t) => (
                              <TaskCard
                                key={t.id}
                                task={t}
                                byId={index.byId}
                                personal={personal}
                                session={session}
                                busy={busy}
                                mutate={mutate}
                                open={openCards.has(t.id)}
                                onToggle={() => toggleCard(t.id)}
                                onExplore={() => {
                                  setSelected(t.id);
                                  setView("graph");
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </>
          );
        }}
      </Load>
    </>
  );
}

function TaskCard({
  task,
  byId,
  personal,
  session,
  busy,
  mutate,
  open,
  onToggle,
  onExplore,
}: {
  task: Task;
  byId: Map<string, Task>;
  personal: boolean;
  session: Session;
  busy: boolean;
  mutate: PageProps["mutate"];
  open: boolean;
  onToggle: () => void;
  onExplore: () => void;
}) {
  const { t: translate, locale } = usePreferences();
  const [confirming, setConfirming] = useState(false);
  const blocked = isBlocked(task, byId);
  const label = translate(open ? "Collapse {title}" : "Expand {title}", {
    title: task.title,
  });
  return (
    <article className={`task-card${personal ? " personal-task" : ""}`}>
      <div className="card-summary" onClick={onToggle}>
        <button
          type="button"
          className="card-toggle"
          aria-expanded={open}
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <span className="card-meta">
          <Badge value={task.status} />
          <Badge value={task.priority} />
        </span>
        <div className="card-heading">
          <h3 className="card-title">{task.title}</h3>
          <span className="card-subtitle">
            {task.owners.map((m) => m.name || m.email || m.id).join(", ") ||
              translate("Unassigned")}
            {task.due && ` · ${formatDate(task.due, locale)}`}
          </span>
        </div>
        {overdueTask(task) && (
          <span className="overdue-label">{translate("Overdue")}</span>
        )}
        {blocked && (
          <span className="blocked-label">{translate("Blocked")}</span>
        )}
      </div>
      {open && (
        <div className="task-card-body">
          {task.url && (
            <div className="card-meta card-meta-links">
              <LinkOut url={task.url} />
            </div>
          )}
          <p>{task.description}</p>
          <div className="task-info">
            <span>
              <Clock3 size={14} />
              {formatDate(task.due, locale)}
            </span>
            <span>
              <Users size={14} />
              {task.owners.map((m) => m.name || m.email || m.id).join(", ") ||
                translate("Unassigned")}
            </span>
            {!!task.divisions.length && (
              <span>{task.divisions.join(" · ")}</span>
            )}
          </div>
          <div className="card-actions">
            <button onClick={onExplore}>{translate("Explore graph")}</button>
            <select
              aria-label={translate("Status for {title}", {
                title: task.title,
              })}
              value={task.status}
              disabled={busy || !session.connected}
              onChange={(event) => {
                const actions: Record<string, string> = {
                  pending: "reopen",
                  in_progress: "start",
                  paused: "pause",
                  completed: "complete",
                  cancelled: "cancel",
                };
                void mutate(
                  `/tasks/${encodeURIComponent(task.id)}/${actions[event.target.value]}`,
                );
              }}
            >
              {["pending", "in_progress", "paused", "completed", "cancelled"]
                .filter(
                  (status) =>
                    task.source === "bitable" ||
                    session.mode === "mock" ||
                    status === task.status ||
                    ["completed", "cancelled"].includes(status),
                )
                .map((status) => (
                  <option key={status} value={status}>
                    {translate(status)}
                  </option>
                ))}
            </select>
            {session.user?.role === "admin" &&
              (confirming ? (
                <>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await mutate(
                          `/tasks/${encodeURIComponent(task.id)}/delete`,
                        )
                      )
                        setConfirming(false);
                    }}
                  >
                    {translate("Confirm delete")}
                  </button>
                  <button onClick={() => setConfirming(false)}>
                    {translate("Keep")}
                  </button>
                </>
              ) : (
                <button
                  className="icon-button"
                  aria-label={translate("Delete {title}", {
                    title: task.title,
                  })}
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 size={14} />
                </button>
              ))}
          </div>
        </div>
      )}
    </article>
  );
}
