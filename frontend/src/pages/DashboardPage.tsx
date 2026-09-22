import { NavLink } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { usePreferences } from "../preferences";
import { useData } from "../useData";
import { formatDate } from "../api";
import { Heading, Load, Empty, Badge } from "../components";
import type { Dashboard, Task } from "../types";
import { graphIndex } from "../taskGraph";
import { activeTask, needsAttention, taskOrder } from "../taskView";

export function DashboardPage({ revision }: { revision: number }) {
  const { t, locale } = usePreferences();
  const state = useData<Dashboard>("/dashboard", revision);
  return (
    <>
      <Heading
        title={t("Team overview")}
        description={t(
          "See what needs attention and help the team move forward.",
        )}
      >
        <NavLink className="button primary" to="/tasks">
          {t("Browse team tasks")} <ArrowUpRight size={16} />
        </NavLink>
      </Heading>
      <Load state={state}>
        {({ tasks, sync }) => {
          const index = graphIndex(tasks);
          const active = tasks.filter(activeTask);
          const completed = tasks.filter(
            (task) => task.status === "completed",
          ).length;
          const tracked = tasks.filter(
            (task) => task.status !== "cancelled",
          ).length;
          const progress = tracked
            ? Math.round((completed / tracked) * 100)
            : 0;
          const groups = [
            ["overdue", "Overdue", "Past the deadline"],
            ["blocked", "Blocked", "Waiting on prerequisites"],
            ["unassigned", "Unassigned", "Needs an owner"],
            ["upcoming", "Due this week", "Next 7 days"],
          ];
          const members = new Map<string, { name: string; tasks: Task[] }>();
          tasks.forEach((task) =>
            task.owners.forEach((owner) => {
              const member = members.get(owner.id) || {
                name: owner.name || owner.email || owner.id,
                tasks: [],
              };
              member.tasks.push(task);
              members.set(owner.id, member);
            }),
          );
          return (
            <>
              {sync && (
                <p className="muted">
                  {t("Last synced")} {formatDate(sync.last_sync, locale)}
                  {sync.warnings.map((warning) => (
                    <span className="notice" key={warning}>
                      {warning}
                    </span>
                  ))}
                </p>
              )}
              <section className="team-progress panel">
                <div>
                  <span className="eyebrow">{t("TEAM PROGRESS")}</span>
                  <h2>{t("{count} active tasks", { count: active.length })}</h2>
                  <p>
                    {t("{done} of {total} tasks completed", {
                      done: completed,
                      total: tracked,
                    })}
                  </p>
                </div>
                <div className="progress-track">
                  <strong>{progress}%</strong>
                  <progress
                    aria-label={t("Team progress")}
                    max={100}
                    value={progress}
                  />
                </div>
              </section>
              <div className="attention-grid">
                {groups.map(([filter, label, hint]) => (
                  <NavLink
                    key={filter}
                    className={`attention-card attention-${filter}`}
                    to={`/tasks?attention=${filter}`}
                  >
                    <span>
                      {t(label)}
                      <ArrowUpRight size={16} />
                    </span>
                    <strong>
                      {
                        tasks.filter((task) =>
                          needsAttention(task, filter, index.byId),
                        ).length
                      }
                    </strong>
                    <small>{t(hint)}</small>
                  </NavLink>
                ))}
              </div>
              <div className="overview-columns">
                <section className="panel">
                  <div className="panel-title">
                    <h2>{t("Needs attention")}</h2>
                    <span className="muted">{t("Overdue and blocked")}</span>
                  </div>
                  {active
                    .filter(
                      (task) =>
                        needsAttention(task, "overdue", index.byId) ||
                        needsAttention(task, "blocked", index.byId),
                    )
                    .sort(taskOrder)
                    .slice(0, 8)
                    .map((task) => (
                      <NavLink
                        className="attention-row"
                        key={task.id}
                        to={`/tasks?task=${encodeURIComponent(task.id)}`}
                      >
                        <div>
                          <strong>{task.title}</strong>
                          <small>
                            {task.owners
                              .map((owner) => owner.name || owner.email || owner.id)
                              .join(", ") || t("Unassigned")}{" "}
                            · {formatDate(task.due, locale)}
                          </small>
                        </div>
                        <Badge
                          value={
                            needsAttention(task, "overdue", index.byId)
                              ? "Overdue"
                              : "Blocked"
                          }
                        />
                      </NavLink>
                    ))}
                  {!active.some(
                    (task) =>
                      needsAttention(task, "overdue", index.byId) ||
                      needsAttention(task, "blocked", index.byId),
                  ) && <Empty>{t("No overdue or blocked tasks.")}</Empty>}
                </section>
                <section className="panel">
                  <div className="panel-title">
                    <h2>{t("Upcoming deadlines")}</h2>
                    <NavLink to="/tasks?attention=upcoming">
                      {t("View tasks")} →
                    </NavLink>
                  </div>
                  {active
                    .filter((task) =>
                      needsAttention(task, "upcoming", index.byId),
                    )
                    .sort(taskOrder)
                    .slice(0, 6)
                    .map((task) => (
                      <NavLink
                        className="attention-row"
                        key={task.id}
                        to={`/tasks?task=${encodeURIComponent(task.id)}`}
                      >
                        <div>
                          <strong>{task.title}</strong>
                          <small>{formatDate(task.due, locale)}</small>
                        </div>
                        <Badge value={task.status} />
                      </NavLink>
                    ))}
                  {!active.some((task) =>
                    needsAttention(task, "upcoming", index.byId),
                  ) && (
                    <Empty>
                      {t("No upcoming deadlines. New tasks will appear here.")}
                    </Empty>
                  )}
                </section>
              </div>
              <section className="panel">
                <div className="panel-title">
                  <h2>{t("Who's working on what")}</h2>
                  <span className="muted">
                    {t("Active assignments by teammate")}
                  </span>
                </div>
                <div className="ownership-grid">
                  {[...members]
                    .sort(
                      (a, b) =>
                        b[1].tasks.filter(activeTask).length -
                        a[1].tasks.filter(activeTask).length,
                    )
                    .map(([id, member]) => (
                      <NavLink
                        key={id}
                        to={`/tasks?owner=${encodeURIComponent(id)}`}
                        className="ownership-card"
                      >
                        <span className="avatar">
                          {member.name.slice(0, 1)}
                        </span>
                        <div>
                          <strong>{member.name}</strong>
                          <small>
                            {t("{count} active", {
                              count: member.tasks.filter(activeTask).length,
                            })}{" "}
                            ·{" "}
                            {t("{count} overdue", {
                              count: member.tasks.filter((task) =>
                                needsAttention(task, "overdue", index.byId),
                              ).length,
                            })}
                          </small>
                        </div>
                        <ArrowUpRight size={15} />
                      </NavLink>
                    ))}
                </div>
                {!members.size && (
                  <Empty>
                    {t("Assigned tasks will appear here after a sync.")}
                  </Empty>
                )}
              </section>
            </>
          );
        }}
      </Load>
    </>
  );
}
