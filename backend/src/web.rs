use crate::{
    App, Error, Result,
    auth::{self, Session},
    model::{Task, TaskInput, now, stats},
    notify, provider,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

pub fn router(app: App) -> Router {
    let dist = app.cfg.value("FRONTEND_DIST", "frontend/dist");
    let assets = ServeDir::new(format!("{dist}/assets"));
    let files = ServeDir::new(dist).fallback(ServeFile::new(format!("{dist}/index.html")));
    Router::new()
        .route("/healthz", get(|| async { Json(json!({"ok":true})) }))
        .route("/oidc/login", get(auth::oidc_login))
        .route("/oidc/callback", get(auth::oidc_callback))
        .route("/auth/login", get(auth::login))
        .route("/auth/feishu", get(auth::feishu_login))
        .route("/oauth/callback", get(auth::feishu_callback))
        .route("/api/session", get(session))
        .route("/api/bootstrap", get(bootstrap))
        .nest_service("/assets", assets)
        .route("/api/logout", post(auth::logout))
        .route("/api/dashboard", get(dashboard))
        .route("/api/tasks", get(tasks).post(create))
        .route("/api/tasks/{id}/relationships", post(relationships))
        .route("/api/tasks/{id}/{action}", post(action))
        .route("/api/task-options", get(options))
        .route("/api/timeline", get(timeline))
        .route("/api/workload", get(workload))
        .route("/api/members", get(members))
        .route("/api/members/refresh", post(refresh))
        .route("/api/sync", post(sync))
        .route("/api/notifications", get(notifications))
        .route("/api/settings", get(settings).put(save_settings))
        .route("/api/settings/test", post(test_email))
        .route("/api/diagnostics", get(diagnostics))
        .route(
            "/api/{*path}",
            get(|| async {
                (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error":"Unknown API endpoint"})),
                )
            }),
        )
        .fallback_service(files)
        .layer(axum::extract::DefaultBodyLimit::max(128 * 1024))
        .layer(axum::middleware::from_fn_with_state(
            app.clone(),
            auth::guard,
        ))
        .layer(TraceLayer::new_for_http())
        .layer(axum::middleware::from_fn(crate::timing::middleware))
        .with_state(app)
}
#[derive(Deserialize)]
struct BootstrapQuery {
    #[serde(default)]
    page: String,
}
async fn bootstrap(
    State(app): State<App>,
    Extension(s): Extension<Session>,
    Query(q): Query<BootstrapQuery>,
) -> Result<Json<Value>> {
    let state = session(State(app.clone()), Extension(s.clone())).await?.0;
    let (path, result) = match q.page.as_str() {
        "/overview" => ("/dashboard", dashboard(State(app.clone())).await),
        "/" | "/tasks" => (
            "/tasks?q=&status=",
            tasks(
                State(app.clone()),
                Extension(s.clone()),
                Query(Filter::default()),
            )
            .await
            .map(|Json(v)| Json(json!(v))),
        ),
        "/timeline" => (
            "/timeline?q=&source=&omit_overdue=true",
            timeline(
                State(app.clone()),
                Query(Filter {
                    omit_overdue: true,
                    ..Default::default()
                }),
            )
            .await,
        ),
        "/workload" => ("/workload", workload(State(app.clone())).await),
        "/notifications" => ("/notifications", notifications(State(app.clone())).await),
        "/settings" => (
            "/settings",
            settings(State(app.clone()), Extension(s.clone())).await,
        ),
        _ => ("", Ok(Json(Value::Null))),
    };
    let mut data = json!({});
    if !path.is_empty() {
        data[path] = match result {
            Ok(Json(value)) => json!({"data":value}),
            Err(Error(status, error)) => json!({"error":error,"status":status.as_u16()}),
        };
    }
    Ok(Json(json!({"session":state,"data":data})))
}
async fn session(State(app): State<App>, Extension(s): Extension<Session>) -> Result<Json<Value>> {
    let open_id = provider::open_id(&app, &s.subject).await?;
    let connected = !s.subject.is_empty() && provider::user_token(&app, &s.subject).await.is_ok();
    Ok(Json(
        json!({"user":if s.subject.is_empty(){Value::Null}else{json!({"name":s.name,"role":s.role,"open_id":open_id})},"csrf_token":s.csrf,"connected":connected,"mode":app.cfg.mode(),"oidc":app.cfg.oidc(),"team_name":app.cfg.value("FEISHU_TENANT_NAME","RoboMaster Research Team")}),
    ))
}
async fn dashboard(State(app): State<App>) -> Result<Json<Value>> {
    let tasks = app.db.tasks().await?;
    let mut events = app.db.events().await?;
    events.extend(tasks.iter().map(Task::event));
    events.sort_by(|a, b| b.importance.cmp(&a.importance).then(b.ts.cmp(&a.ts)));
    let sync = serde_json::from_str::<Value>(&app.db.setting("sync").await?).unwrap_or(Value::Null);
    let members = app.db.members().await?;
    Ok(Json(
        json!({"tasks":tasks,"stats":stats(&tasks),"important":events.into_iter().filter(|e|e.importance>=2).take(10).collect::<Vec<_>>(),"members":members,"sync":sync}),
    ))
}
#[derive(Default, Deserialize)]
struct Filter {
    #[serde(default)]
    q: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    omit_overdue: bool,
}
async fn tasks(
    State(app): State<App>,
    Extension(s): Extension<Session>,
    Query(f): Query<Filter>,
) -> Result<Json<Vec<Task>>> {
    auth::require_connection(&app, &s).await?;
    let q = f.q.to_lowercase();
    Ok(Json(
        app.db
            .tasks()
            .await?
            .into_iter()
            .filter(|t| {
                (f.status.is_empty() || t.status == f.status)
                    && (f.source.is_empty() || t.source == f.source)
                    && format!("{} {}", t.title, t.description)
                        .to_lowercase()
                        .contains(&q)
            })
            .collect(),
    ))
}
async fn create(
    State(app): State<App>,
    Extension(s): Extension<Session>,
    Json(mut input): Json<TaskInput>,
) -> Result<(StatusCode, Json<Task>)> {
    auth::require_connection(&app, &s).await?;
    input.validate().map_err(Error::bad)?;
    let _lock = app.sync_lock.lock().await;
    let t = provider::create(&app, &s.subject, input)
        .await
        .map_err(|e| {
            if let Some(fe) = e.downcast_ref::<provider::FeishuError>() {
                Error(StatusCode::BAD_GATEWAY, fe.to_string())
            } else {
                Error::bad(e.to_string())
            }
        })?;
    notify::task(&app, "created", &t, &s.name).await;
    Ok((StatusCode::CREATED, Json(t)))
}
async fn relationships(
    State(app): State<App>,
    Extension(s): Extension<Session>,
    Path(id): Path<String>,
    Json(mut input): Json<crate::graph::Relationships>,
) -> Result<Json<Task>> {
    auth::require_connection(&app, &s).await?;
    let _lock = app.sync_lock.lock().await;
    let mut task = app
        .db
        .task(&id)
        .await?
        .ok_or(Error(StatusCode::NOT_FOUND, "Task not found".into()))?;
    if task.source != "bitable" && (app.cfg.live() || task.source != "mock") {
        return Err(Error::bad(
            "Relationship editing is supported for Bitable tasks only",
        ));
    }
    let mut tasks = app.db.tasks().await?;
    // Read the source table before validation so external changes are considered.
    if app.cfg.live() {
        tasks = provider::relationship_tasks(&app, &s.subject, &task.table_id).await?;
        task = tasks.iter().find(|t| t.id == id).cloned().ok_or(Error(
            StatusCode::NOT_FOUND,
            "Task no longer exists in Feishu".into(),
        ))?;
    }
    if !input.unchanged_since(&task) {
        return Err(Error(
            StatusCode::CONFLICT,
            "Relationships changed. Sync and reopen the editor before saving.".into(),
        ));
    }
    input.validate(&task, &tasks).map_err(Error::bad)?;
    provider::save_relationships(&app, &s.subject, &mut task, &input).await?;
    Ok(Json(task))
}
async fn action(
    State(app): State<App>,
    Extension(s): Extension<Session>,
    Path((id, action)): Path<(String, String)>,
) -> Result<Json<Value>> {
    if !["complete", "cancel", "delete", "start", "pause", "reopen"].contains(&action.as_str()) {
        return Err(Error::bad("Invalid task action"));
    }
    if action == "delete" {
        auth::require_admin(&s)?;
    }
    auth::require_connection(&app, &s).await?;
    let _lock = app.sync_lock.lock().await;
    let mut t = app
        .db
        .task(&id)
        .await?
        .ok_or(Error(StatusCode::NOT_FOUND, "Task not found".into()))?;
    provider::action(&app, &s.subject, &mut t, &action).await?;
    notify::task(
        &app,
        match action.as_str() {
            "complete" => "completed",
            "cancel" => "cancelled",
            "start" => "started",
            "pause" => "paused",
            "reopen" => "reopened",
            _ => "deleted",
        },
        &t,
        &s.name,
    )
    .await;
    Ok(Json(json!({"ok":true})))
}
async fn all_events(app: &App) -> anyhow::Result<Vec<crate::model::Event>> {
    let mut events = app.db.events().await?;
    events.extend(app.db.tasks().await?.iter().map(Task::event));
    events.sort_by(|a, b| a.ts.cmp(&b.ts));
    Ok(events)
}
async fn timeline(State(app): State<App>, Query(f): Query<Filter>) -> Result<Json<Value>> {
    let q = f.q.to_lowercase();
    let current = chrono::Utc::now().timestamp_millis();
    Ok(Json(json!(
        all_events(&app)
            .await?
            .into_iter()
            .filter(
                |e| (f.source.is_empty() || f.source.split(',').any(|s| s == e.source))
                    && format!("{} {}", e.title, e.description)
                        .to_lowercase()
                        .contains(&q)
                    && (!f.omit_overdue
                        || e.ts.is_empty()
                        || crate::model::timestamp(&e.ts).is_some_and(|t| t >= current))
            )
            .collect::<Vec<_>>()
    )))
}
async fn workload(State(app): State<App>) -> Result<Json<Value>> {
    let tasks = app.db.tasks().await?;
    let mut people: std::collections::BTreeMap<String, (String, String, Vec<Task>)> =
        std::collections::BTreeMap::new();
    for t in &tasks {
        for m in &t.owners {
            let key = if m.id.is_empty() {
                m.name.clone()
            } else {
                m.id.clone()
            };
            if key.is_empty() {
                continue;
            }
            let entry = people.entry(key).or_insert_with(|| {
                (
                    if m.name.is_empty() {
                        m.id.clone()
                    } else {
                        m.name.clone()
                    },
                    m.email.clone(),
                    vec![],
                )
            });
            entry.2.push(t.clone());
        }
    }
    let mut members:Vec<_>=people.into_iter().map(|(id,(name,email,t))|json!({"id":id,"name":name,"email":email,"active":t.iter().filter(|t|t.active()).count(),"stats":stats(&t),"tasks":t})).collect();
    members.sort_by_key(|m| std::cmp::Reverse(m["active"].as_u64().unwrap_or(0)));
    Ok(Json(
        json!({"members":members,"unassigned":tasks.iter().filter(|t|t.owners.is_empty()).count()}),
    ))
}
async fn members(State(app): State<App>) -> Result<Json<Value>> {
    Ok(Json(json!(app.db.members().await?)))
}
async fn options(State(app): State<App>, Extension(s): Extension<Session>) -> Result<Json<Value>> {
    auth::require_connection(&app, &s).await?;
    Ok(Json(provider::options(&app, &s.subject).await?))
}
async fn refresh(State(app): State<App>, Extension(s): Extension<Session>) -> Result<Json<Value>> {
    auth::require_admin(&s)?;
    auth::require_connection(&app, &s).await?;
    Ok(Json(provider::refresh_members(&app, &s.subject).await?))
}
async fn sync(State(app): State<App>, Extension(s): Extension<Session>) -> Result<Json<Value>> {
    auth::require_admin(&s)?;
    auth::require_connection(&app, &s).await?;
    Ok(Json(provider::sync(&app, &s.subject).await?))
}
async fn notifications(State(app): State<App>) -> Result<Json<Value>> {
    let _timer = crate::timing::Timer::start("db");
    let rows = sqlx::query("SELECT * FROM notifications ORDER BY id DESC LIMIT 200")
        .fetch_all(&app.db.0)
        .await?;
    Ok(Json(json!(rows.iter().map(|r|json!({"id":r.get::<i64,_>("id"),"created_at":r.get::<String,_>("created_at"),"kind":r.get::<String,_>("kind"),"subject":r.get::<String,_>("subject"),"body":r.get::<String,_>("body"),"recipients":r.get::<String,_>("recipients"),"status":r.get::<String,_>("status"),"error":r.get::<String,_>("error")})).collect::<Vec<_>>())))
}
async fn settings(State(app): State<App>, Extension(s): Extension<Session>) -> Result<Json<Value>> {
    auth::require_admin(&s)?;
    Ok(Json(notify::settings(&app).await?))
}
#[derive(Deserialize)]
struct SettingsInput {
    email_recipients: String,
}
async fn save_settings(
    State(app): State<App>,
    Extension(s): Extension<Session>,
    Json(input): Json<SettingsInput>,
) -> Result<Json<Value>> {
    auth::require_admin(&s)?;
    for email in input
        .email_recipients
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|s| !s.is_empty())
    {
        email
            .parse::<lettre::message::Mailbox>()
            .map_err(|_| Error::bad("Invalid email address"))?;
    }
    app.db
        .set("email_recipients", input.email_recipients.trim())
        .await?;
    Ok(Json(json!({"ok":true})))
}
async fn test_email(
    State(app): State<App>,
    Extension(s): Extension<Session>,
) -> Result<Json<Value>> {
    auth::require_admin(&s)?;
    notify::deliver(
        &app,
        "test",
        "LarkAI notification test",
        "Your notification settings are working.",
        vec![],
    )
    .await?;
    Ok(Json(json!({"ok":true})))
}
async fn diagnostics(
    State(app): State<App>,
    Extension(s): Extension<Session>,
) -> Result<Json<Value>> {
    auth::require_admin(&s)?;
    let token = auth::require_connection(&app, &s).await?;
    let mut checks = vec![
        json!({"name":"Database","ok":true,"detail":"Connected"}),
        json!({"name":"Mode","ok":true,"detail":app.cfg.mode()}),
    ];
    if app.cfg.live() {
        for (name, path) in [
            ("Feishu identity", "/authen/v1/user_info"),
            ("Tasks", "/task/v2/tasks?type=my_tasks&page_size=1"),
            ("Chats", "/im/v1/chats?page_size=1"),
            ("Calendars", "/calendar/v4/calendars?page_size=1"),
        ] {
            let ok = provider::call(&app, "GET", path, &token, None)
                .await
                .is_ok();
            checks.push(json!({"name":name,"ok":ok,"detail":if ok{"Reachable"}else{"Unavailable; check scopes and server logs"}}));
        }
    }
    Ok(Json(json!({"checks":checks,"checked_at":now()})))
}
