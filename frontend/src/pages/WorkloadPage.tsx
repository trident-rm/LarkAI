import { usePreferences } from "../preferences";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Workload } from "../types";
import { useData } from "../useData";
import { Heading, Load, Empty, Badge, TaskSummary } from "../components";

export function WorkloadPage({ revision }: { revision: number }) {
  const { t } = usePreferences();
  const state = useData<Workload>("/workload", revision);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <>
      <Heading
        title={t("Team workload")}
        description={t("See who’s working on what, and where help is needed.")}
      />
      <Load state={state}>
        {(d) => (
          <>
            <div className="workload-tools">
              <p className="muted">
                {t("{count} team members · {unassigned} unassigned tasks", {
                  count: d.members.length,
                  unassigned: d.unassigned,
                })}
              </p>
              {d.members.length > 0 && (
                <button
                  className="collapse-all"
                  onClick={() =>
                    setOpen(
                      open.size
                        ? new Set()
                        : new Set(d.members.map((m) => m.id)),
                    )
                  }
                >
                  {open.size ? t("Collapse all") : t("Expand all")}
                </button>
              )}
            </div>
            <div className="workload-grid">
              {d.members.map((m) => (
                <section className="panel workload-member" key={m.id}>
                  <div className="workload-head" onClick={() => toggle(m.id)}>
                    <button
                      type="button"
                    className="card-toggle"
                    aria-expanded={open.has(m.id)}
                    aria-label={t(
                      open.has(m.id) ? "Collapse {title}" : "Expand {title}",
                      { title: m.name || m.email || m.id },
                    )}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggle(m.id);
                      }}
                    >
                      {open.has(m.id) ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                    </button>
                    <div className="panel-title">
                      <h2>{m.name || m.email || m.id}</h2>
                      <Badge value={t("{count} active", { count: m.active })} />
                    </div>
                    <div className="workload-stats">
                      <span>
                        {t("{count} pending", { count: m.stats.pending })}
                      </span>
                      <span>
                        {t("{count} done", { count: m.stats.completed })}
                      </span>
                      <span>
                        {t("{count} overdue", { count: m.stats.overdue })}
                      </span>
                    </div>
                  </div>
                  {open.has(m.id) && (
                    <div className="workload-tasks">
                      {m.tasks.map((t) => (
                        <TaskSummary key={t.id} task={t} />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
            {!d.members.length && (
              <Empty>
                {t("Assigned tasks will appear here after a sync.")}
              </Empty>
            )}
          </>
        )}
      </Load>
    </>
  );
}
