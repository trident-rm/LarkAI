import { usePreferences } from "../preferences";
import { useState } from "react";
import type { FormEvent } from "react";
import { Plus } from "lucide-react";
import type { Member } from "../types";

export function TaskForm({
  members,
  options,
  submit,
  busy,
}: {
  members: Member[];
  options: { categories: string[]; divisions: string[] };
  submit: (body: unknown) => Promise<boolean>;
  busy: boolean;
}) {
  const { t } = usePreferences();
  const [q, setQ] = useState("");
  const [owners, setOwners] = useState<string[]>([]);
  const [divisions, setDivisions] = useState<string[]>([]);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const due = String(d.get("due") || "");
    if (
      await submit({
        title: d.get("title"),
        description: d.get("description"),
        due: due ? new Date(due).toISOString() : "",
        priority: d.get("priority"),
        category: d.get("category"),
        remark: d.get("remark"),
        owner_ids: owners,
        divisions,
      })
    ) {
      form.reset();
      setOwners([]);
      setDivisions([]);
    }
  }
  return (
    <form className="task-form" onSubmit={onSubmit}>
      <h2>{t("Create a task")}</h2>
      <label>
        {t("Title")}
        <input
          name="title"
          required
          maxLength={500}
          placeholder={t("What needs to be done?")}
        />
      </label>
      <label>
        {t("Description")}
        <textarea
          name="description"
          rows={3}
          placeholder={t("Context, requirements, and expected outcome")}
        />
      </label>
      <div className="form-grid">
        <label>
          {t("Due date")}
          <input type="datetime-local" name="due" />
        </label>
        <label>
          {t("Priority")}
          <select
            aria-label={t("Priority")}
            name="priority"
            defaultValue="NORMAL"
          >
            {["LOW", "NORMAL", "MEDIUM", "HIGH", "URGENT"].map((p) => (
              <option key={p} value={p}>
                {t(p)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Category")}
          <select aria-label={t("Category")} name="category">
            <option value="">{t("Choose a category")}</option>
            {options.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend>{t("Divisions")}</legend>
        <div className="chips">
          {options.divisions.map((d) => (
            <label key={d}>
              <input
                type="checkbox"
                checked={divisions.includes(d)}
                onChange={() =>
                  setDivisions((s) =>
                    s.includes(d) ? s.filter((v) => v !== d) : [...s, d],
                  )
                }
              />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>
          {t("Assignees ·")} {owners.length || t("yourself by default")}
        </legend>
        <input
          aria-label={t("Search assignees")}
          placeholder={t("Search members…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="chips">
          {members
            .filter((m) =>
              `${m.name} ${m.email}`.toLowerCase().includes(q.toLowerCase()),
            )
            .map((m) => (
              <label key={m.id}>
                <input
                  type="checkbox"
                  checked={owners.includes(m.id)}
                  onChange={() =>
                    setOwners((s) =>
                      s.includes(m.id)
                        ? s.filter((v) => v !== m.id)
                        : [...s, m.id],
                    )
                  }
                />
                {m.name || m.email || m.id}
              </label>
            ))}
        </div>
      </fieldset>
      <label>
        {t("Remark")}
        <input name="remark" />
      </label>
      <button disabled={busy} className="primary">
        <Plus size={16} /> {busy ? t("Creating…") : t("Create task")}
      </button>
    </form>
  );
}
