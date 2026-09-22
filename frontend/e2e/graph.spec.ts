import { test, expect } from "@playwright/test";

test("task graph separates hierarchy, edits dependencies, rejects cycles and works on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/auth/feishu?next=/tasks");
  const session = await (await page.request.get("/api/session")).json();
  const headers = { "X-CSRF-Token": session.csrf_token };
  const ids: string[] = [];
  async function create(title: string) {
    const response = await page.request.post("/api/tasks", {
      headers,
      data: { title, description: "Test graph workflow", divisions: ["机械"] },
    });
    expect(response.status()).toBe(201);
    const task = await response.json();
    ids.push(task.id);
    return task;
  }
  async function link(id: string, parent: string[], deps: string[]) {
    const response = await page.request.post(
      `/api/tasks/${encodeURIComponent(id)}/relationships`,
      {
        headers,
        data: {
          parent_ids: parent,
          dependency_ids: deps,
          expected_parent_ids: [],
          expected_dependency_ids: [],
        },
      },
    );
    expect(response.ok()).toBeTruthy();
  }
  try {
    const parent = await create("Test DAG project");
    const design = await create("Test Design");
    const parts = await create("Test Parts");
    const assembly = await create("Test Assembly");
    const verification = await create("Test Verification");
    const wiring = await create("Test Wiring");
    await link(design.id, [parent.id], []);
    await link(parts.id, [parent.id], []);
    await link(assembly.id, [parent.id], [design.id, parts.id]);
    await link(verification.id, [parent.id], [assembly.id]);
    await link(wiring.id, [assembly.id], []);
    await page.reload();
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    const hierarchy = page.getByRole("complementary", {
      name: "Task hierarchy",
    });
    await hierarchy
      .getByRole("button", { name: "Test Assembly", exact: true })
      .click();
    const graph = page.getByRole("region", {
      name: "Dependency graph",
      exact: true,
    });
    await expect(graph.locator(".graph-node")).toHaveCount(6);
    await expect(graph.locator('[data-relationship="hierarchy"]')).toHaveCount(
      5,
    );
    await expect(graph.locator('[data-relationship="dependency"]')).toHaveCount(
      3,
    );
    await page.getByLabel("Show hierarchy", { exact: true }).uncheck();
    await expect(graph.locator(".graph-node")).toHaveCount(4);
    await expect(
      page.getByText("Blocked by unfinished prerequisites"),
    ).toBeVisible();
    await expect(
      graph.getByRole("button", { name: "Explore Test Wiring", exact: true }),
    ).toHaveCount(0);
    await hierarchy
      .getByRole("button", { name: "Collapse Test Assembly", exact: true })
      .click();
    await expect(
      hierarchy.getByRole("button", { name: "Test Wiring", exact: true }),
    ).toHaveCount(0);
    await hierarchy
      .getByRole("button", { name: "Expand Test Assembly", exact: true })
      .click();
    await expect(
      hierarchy.getByRole("button", { name: "Test Wiring", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Search tasks", { exact: true })
      .fill("Test Assembly");
    await expect(graph.locator(".graph-node")).toHaveCount(4);
    await page.getByLabel("Search tasks", { exact: true }).fill("");
    await graph.getByRole("button", { name: "Fit graph", exact: true }).click();
    await page.getByLabel("Show hierarchy", { exact: true }).check();
    await graph.getByRole("button", { name: "Fit graph", exact: true }).click();
    await page.screenshot({
      path: "test-results/task-graph-desktop.png",
      fullPage: true,
    });
    await page.getByLabel("Show hierarchy", { exact: true }).uncheck();
    await page
      .getByRole("button", { name: "Edit relationships", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Test Parts", exact: true })
      .uncheck();
    await page
      .getByRole("button", { name: "Save relationships", exact: true })
      .click();
    await expect(graph.locator(".graph-node")).toHaveCount(3);
    await graph
      .getByRole("button", { name: "Explore Test Design", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit relationships", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Test Verification", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Save relationships", exact: true })
      .click();
    await expect(page.getByText(/Dependency cycle:/)).toBeVisible();
    await page
      .getByRole("button", { name: "Close editor", exact: true })
      .click();
    for (const [id, action] of [
      [parent.id, "complete"],
      [design.id, "cancel"],
    ]) {
      const response = await page.request.post(
        `/api/tasks/${encodeURIComponent(id)}/${action}`,
        { headers },
      );
      expect(response.ok()).toBeTruthy();
    }
    await page.reload();
    const hideFinished = page.getByRole("checkbox", {
      name: "Hide completed and cancelled",
      exact: true,
    });
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Test DAG project", exact: true }),
    ).toBeVisible();
    await hideFinished.check();
    await expect(
      page.getByRole("heading", { name: "Test DAG project", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Test Design", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    await expect(hideFinished).toBeChecked();
    await page.getByLabel("Entire graph", { exact: true }).check();
    for (const title of ["Test DAG project", "Test Design"]) {
      await expect(
        hierarchy.getByRole("button", { name: title, exact: true }),
      ).toHaveCount(0);
      await expect(
        graph.getByRole("button", { name: `Explore ${title}`, exact: true }),
      ).toHaveCount(0);
    }
    await expect(
      hierarchy.getByRole("button", { name: "Test Assembly", exact: true }),
    ).toBeVisible();
    await hideFinished.uncheck();
    await graph
      .getByRole("button", { name: "Explore Test Design", exact: true })
      .click();
    await hideFinished.check();
    await expect(
      page
        .getByRole("complementary", { name: "Task details" })
        .getByRole("heading", { name: "Test Design", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(hideFinished).toBeChecked();
    await hideFinished.uncheck();
    await expect(
      page.getByRole("heading", { name: "Test Design", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    await page
      .getByRole("button", { name: "Switch to dark mode", exact: true })
      .click();
    await page.getByLabel("Language", { exact: true }).selectOption("zh");
    await expect(
      page.getByRole("region", { name: "依赖关系图", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".sidebar")).toHaveCSS(
      "transform",
      "matrix(1, 0, 0, 1, -210, 0)",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/task-graph-mobile-dark.png",
      fullPage: true,
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  } finally {
    for (const id of ids.reverse())
      await page.request.post(`/api/tasks/${encodeURIComponent(id)}/delete`, {
        headers,
      });
  }
});
