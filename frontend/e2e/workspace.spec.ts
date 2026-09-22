import { test, expect } from "@playwright/test";
test("mock workspace supports login, task lifecycle, workload and notifications", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tasks");
  await expect(page.getByText("Sign in to continue")).toBeVisible();
  await page.getByRole("link", { name: "Continue", exact: false }).click();
  await expect(page.getByText("Demo Driver", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New task" }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Validate drivetrain firmware");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Run the bench test before assembly.");
  await page.getByLabel("Due date").fill("2030-01-01T12:00");
  await page.getByLabel("Priority", { exact: true }).selectOption("HIGH");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "pending 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Run the bench test before assembly."),
  ).toBeHidden();
  await page.getByRole("button", { name: "Expand all", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Validate drivetrain firmware" }),
  ).toBeVisible();
  await expect(
    page.getByText("Run the bench test before assembly."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Team overview", exact: true }).click();
  await expect(
    page.getByText("1 active · 0 overdue", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Team tasks", exact: true }).click();
  await page.getByRole("button", { name: "Expand all", exact: true }).click();
  await page
    .getByLabel("Status for Validate drivetrain firmware", { exact: true })
    .selectOption("completed");
  await expect(
    page.getByRole("heading", { name: "completed 1" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Administration", exact: true }).click();
  await page
    .getByRole("link", { name: "Email delivery log", exact: true })
    .click();
  await expect(
    page.getByText(/Task completed: Validate drivetrain firmware/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Team tasks", exact: true }).click();
  await page.getByRole("button", { name: "Expand all", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete Validate drivetrain firmware" })
    .click();
  await page
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(
    page.getByText("No tasks match.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Team overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Team overview" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/overview.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Team overview" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".sidebar")).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, -210, 0)",
  );
  await page.screenshot({
    path: "test-results/mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("startup bundles session and page data without loading unopened task form options", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/"))
      requests.push(new URL(r.url()).pathname);
  });
  await page.goto("/auth/feishu?next=/tasks");
  await expect(page.getByRole("button", { name: "New task" })).toBeVisible();
  await expect(
    page.getByText("No tasks match.", { exact: false }),
  ).toBeVisible();
  expect(requests).toEqual(["/api/bootstrap"]);
  requests.length = 0;
  await page.reload();
  await expect(
    page.getByText("No tasks match.", { exact: false }),
  ).toBeVisible();
  expect(requests).toEqual(["/api/bootstrap"]);
});

test("theme and language persist while task drafts and API values stay intact", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/auth/feishu?next=/tasks");
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Bilingual draft");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".topbar")).toHaveCSS(
    "background-color",
    "rgb(28, 38, 55)",
  );
  await page.getByLabel("Language", { exact: true }).selectOption("zh");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "团队任务" })).toBeVisible();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
    "Bilingual draft",
  );
  await page.getByLabel("优先级", { exact: true }).selectOption("HIGH");
  await expect(page.getByLabel("优先级", { exact: true })).toHaveValue("HIGH");
  await page.getByLabel("筛选状态").selectOption("in_progress");
  await expect(page.getByLabel("筛选状态")).toHaveValue("in_progress");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "团队任务" })).toBeVisible();
  await page.getByRole("link", { name: "团队概览", exact: true }).click();
  await expect(page.getByRole("heading", { name: "团队概览" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("语言", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/dark-chinese-mobile.png",
    animations: "disabled",
    fullPage: true,
  });
  await page.getByRole("button", { name: "切换至浅色模式" }).click();
  await page.getByLabel("语言", { exact: true }).selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Team overview" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("system dark mode works when browser storage is unavailable", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage unavailable");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable");
    };
  });
  await page.goto("/auth/feishu?next=/overview");
  await expect(
    page.getByRole("heading", { name: "Team overview" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.getByLabel("Language", { exact: true }).selectOption("zh");
  await expect(page.getByRole("heading", { name: "团队概览" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("member home filters by identity, supports assignments to others, and persists status updates", async ({
  page,
}) => {
  await page.goto("/auth/feishu?next=/");
  await expect(
    page.getByRole("heading", { name: "My Tasks", exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  expect(session.user.open_id).toBeTruthy();
  const headers = { "X-CSRF-Token": session.csrf_token };
  const own = await (
    await page.request.post("/api/tasks", {
      headers,
      data: { title: "Member bench test" },
    })
  ).json();
  const other = await (
    await page.request.post("/api/tasks", {
      headers,
      data: { title: "Another member task", owner_ids: ["ou_someone_else"] },
    })
  ).json();
  try {
    await page.reload();
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Member bench test", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Another member task", exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel("Status for Member bench test", { exact: true })
      .selectOption("in_progress");
    await expect(
      page.getByLabel("Status for Member bench test", { exact: true }),
    ).toHaveValue("in_progress");
    await page.reload();
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    await expect(
      page.getByLabel("Status for Member bench test", { exact: true }),
    ).toHaveValue("in_progress");
    await page
      .getByLabel("Status for Member bench test", { exact: true })
      .selectOption("paused");
    await expect(
      page.getByLabel("Status for Member bench test", { exact: true }),
    ).toHaveValue("paused");
    await page
      .getByLabel("Status for Member bench test", { exact: true })
      .selectOption("completed");
    await expect(
      page.getByRole("heading", { name: "Member bench test", exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel("Hide completed and cancelled", { exact: true })
      .uncheck();
    await page
      .getByLabel("Status for Member bench test", { exact: true })
      .selectOption("pending");
    await expect(
      page.getByLabel("Status for Member bench test", { exact: true }),
    ).toHaveValue("pending");
    await page.getByRole("link", { name: "Team tasks", exact: true }).click();
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Another member task", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "My Tasks", exact: true }).click();
    await page.screenshot({
      path: "test-results/my-tasks-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/my-tasks-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    for (const task of [own, other])
      await page.request.post(
        `/api/tasks/${encodeURIComponent(task.id)}/delete`,
        { headers },
      );
  }
});

test("team overview opens attention filters and task graph context", async ({
  page,
}) => {
  await page.goto("/auth/feishu?next=/overview");
  const session = await (await page.request.get("/api/session")).json();
  const headers = { "X-CSRF-Token": session.csrf_token };
  const created: { id: string }[] = [];
  async function create(title: string, due: string, description: string) {
    const response = await page.request.post("/api/tasks", {
      headers,
      data: { title, due, description, divisions: ["机械"], priority: "HIGH" },
    });
    expect(response.status()).toBe(201);
    const task = await response.json();
    created.push(task);
    return task;
  }
  try {
    const overdue = await create(
      "Finish chassis drawings",
      "2020-01-01T12:00:00Z",
      "Review the mounting points before machining.",
    );
    const soon = await create(
      "Run drivetrain bench test",
      new Date(Date.now() + 86400000).toISOString(),
      "Validate the motor controller against the new chassis.",
    );
    const later = await create(
      "Prepare competition checklist",
      "2035-01-01T12:00:00Z",
      "Collect acceptance criteria from each division.",
    );
    expect(
      (
        await page.request.post(
          `/api/tasks/${encodeURIComponent(soon.id)}/relationships`,
          {
            headers,
            data: {
              parent_ids: [],
              dependency_ids: [overdue.id],
              expected_parent_ids: [],
              expected_dependency_ids: [],
            },
          },
        )
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "3 active tasks", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/team-overview-populated.png",
      fullPage: true,
      animations: "disabled",
    });
    await page.locator(".attention-overdue").click();
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: overdue.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: later.title, exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: later.title, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Team overview", exact: true })
      .click();
    await page.locator(".attention-upcoming").click();
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: soon.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: overdue.title, exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("link", { name: "Team overview", exact: true })
      .click();
    await page
      .locator(".attention-row")
      .filter({ hasText: soon.title })
      .first()
      .click();
    await expect(
      page
        .getByRole("complementary", { name: "Task details" })
        .getByRole("heading", { name: soon.title, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Team overview", exact: true })
      .click();
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
      path: "test-results/team-overview-mobile-populated.png",
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    for (const task of created.reverse())
      await page.request.post(
        `/api/tasks/${encodeURIComponent(task.id)}/delete`,
        { headers },
      );
  }
});
