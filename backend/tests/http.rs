use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use larkai::{
    App,
    auth::{Session, save},
    config::Config,
    model::{Task, TaskInput},
    provider, web,
};
use serde_json::{Value, json};
use tower::ServiceExt;

async fn app() -> App {
    App::new(Config(
        [
            ("DATABASE_PATH".into(), ":memory:".into()),
            ("FEISHU_MODE".into(), "mock".into()),
        ]
        .into(),
    ))
    .await
    .unwrap()
}
async fn request(
    router: &Router,
    method: &str,
    path: &str,
    cookie: &str,
    csrf: &str,
    body: Option<Value>,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Cookie", cookie)
        .header("X-CSRF-Token", csrf)
        .header("Content-Type", "application/json")
        .body(Body::from(body.map(|b| b.to_string()).unwrap_or_default()))
        .unwrap();
    let response = router.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, headers, value)
}
async fn login(router: &Router) -> (String, String) {
    let (status, headers, _) =
        request(router, "GET", "/auth/feishu?next=/tasks", "", "", None).await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    assert_eq!(headers["location"], "/tasks");
    let cookie = headers["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let (_, _, session) = request(router, "GET", "/api/session", &cookie, "", None).await;
    assert_eq!(session["connected"], true);
    assert_eq!(session["user"]["role"], "admin");
    (cookie, session["csrf_token"].as_str().unwrap().into())
}
#[tokio::test]
async fn mock_lifecycle_persists_and_audits() {
    let app = app().await;
    let router = web::router(app.clone());
    let (cookie, csrf) = login(&router).await;
    let (status,_,t)=request(&router,"POST","/api/tasks",&cookie,&csrf,Some(json!({"title":"Build drivetrain","due":"2030-01-01T12:00:00Z","priority":"HIGH","divisions":["机械"]}))).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(t["owners"][0]["name"], "Demo Driver");
    let id = t["id"].as_str().unwrap();
    let (_, _, d) = request(&router, "GET", "/api/dashboard", &cookie, "", None).await;
    assert_eq!(d["stats"]["pending"], 1);
    assert_eq!(
        request(
            &router,
            "POST",
            &format!("/api/tasks/{id}/complete"),
            &cookie,
            &csrf,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, _, w) = request(&router, "GET", "/api/workload", &cookie, "", None).await;
    assert_eq!(w["members"][0]["stats"]["completed"], 1);
    assert_eq!(
        request(
            &router,
            "POST",
            &format!("/api/tasks/{id}/cancel"),
            &cookie,
            &csrf,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(app.db.task(id).await.unwrap().unwrap().status, "cancelled");
    assert_eq!(
        request(
            &router,
            "POST",
            &format!("/api/tasks/{id}/delete"),
            &cookie,
            &csrf,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(app.db.tasks().await.unwrap().is_empty());
    let (_, _, audit) = request(&router, "GET", "/api/notifications", &cookie, "", None).await;
    assert_eq!(audit.as_array().unwrap().len(), 4);
    assert_eq!(
        request(&router, "POST", "/api/logout", &cookie, &csrf, None)
            .await
            .0,
        StatusCode::OK
    );
    let (_, _, s) = request(&router, "GET", "/api/session", &cookie, "", None).await;
    assert!(s["user"].is_null());
}
#[tokio::test]
async fn csrf_validation_and_role_guards_precede_mutations() {
    let app = app().await;
    let router = web::router(app.clone());
    let (cookie, csrf) = login(&router).await;
    assert_eq!(
        request(
            &router,
            "POST",
            "/api/tasks",
            &cookie,
            "wrong",
            Some(json!({"title":"forged"}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert!(app.db.tasks().await.unwrap().is_empty());
    assert_eq!(
        request(
            &router,
            "POST",
            "/api/tasks",
            &cookie,
            &csrf,
            Some(json!({"title":" "}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &router,
            "POST",
            "/api/tasks",
            &cookie,
            &csrf,
            Some(json!({"title":"date","due":"tomorrow"}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let s = Session {
        id: "member-session".into(),
        subject: "member".into(),
        role: "member".into(),
        csrf: "token".into(),
        ..Default::default()
    };
    save(&app, &s).await.unwrap();
    for (method, path) in [
        ("POST", "/api/sync"),
        ("POST", "/api/members/refresh"),
        ("GET", "/api/settings"),
        ("GET", "/api/diagnostics"),
        ("POST", "/api/tasks/unknown/delete"),
    ] {
        assert_eq!(
            request(
                &router,
                method,
                path,
                "larkai=member-session",
                "token",
                None
            )
            .await
            .0,
            StatusCode::FORBIDDEN,
            "{path}"
        );
    }
    assert_eq!(
        request(
            &router,
            "GET",
            "/api/tasks",
            "larkai=member-session",
            "",
            None
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        request(
            &router,
            "GET",
            "/api/dashboard",
            "larkai=member-session",
            "",
            None
        )
        .await
        .0,
        StatusCode::OK
    );
}
#[tokio::test]
async fn oidc_requires_authentication_and_callbacks_require_state() {
    let mut app = app().await;
    app.cfg
        .0
        .insert("OIDC_ISSUER".into(), "https://identity.example".into());
    let router = web::router(app);
    assert_eq!(
        request(&router, "GET", "/healthz", "", "", None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        request(&router, "GET", "/api/dashboard", "", "", None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, headers, _) = request(&router, "GET", "/tasks", "", "", None).await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    assert_eq!(headers["location"], "/oidc/login");
    assert_eq!(
        request(
            &router,
            "GET",
            "/oidc/callback?code=bad&state=bad",
            "",
            "",
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}
#[tokio::test]
async fn connections_cannot_be_taken_by_another_identity() {
    let app = app().await;
    provider::save_connection(
        &app,
        "subject-a",
        "ou_one",
        &json!({"access_token":"secret","expires_at":i64::MAX}),
    )
    .await
    .unwrap();
    assert!(
        provider::save_connection(&app, "subject-b", "ou_one", &json!({}))
            .await
            .is_err()
    );
    assert_eq!(
        provider::open_id(&app, "subject-a").await.unwrap(),
        "ou_one"
    );
}
#[tokio::test]
async fn task_api_contract_keeps_priority_local_and_uses_milliseconds() {
    let mut app = app().await;
    let upstream = Router::new().route(
        "/open-apis/task/v2/tasks",
        axum::routing::post(
            |headers: axum::http::HeaderMap, axum::Json(body): axum::Json<Value>| async move {
                assert_eq!(headers["authorization"], "Bearer user-secret");
                assert!(body.get("priority").is_none());
                assert_eq!(body["due"]["timestamp"], "1893456000000");
                assert_eq!(body["members"][0]["role"], "assignee");
                axum::Json(
                    json!({"code":0,"data":{"task":{"guid":"remote-task","summary":"Test"}}}),
                )
            },
        ),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    app.cfg.0.insert("FEISHU_MODE".into(), "live".into());
    app.cfg
        .0
        .insert("FEISHU_BASE_URL".into(), format!("http://{address}"));
    provider::save_connection(
        &app,
        "subject",
        "ou_user",
        &json!({"access_token":"user-secret","expires_at":i64::MAX}),
    )
    .await
    .unwrap();
    let task = provider::create(
        &app,
        "subject",
        TaskInput {
            title: "Test".into(),
            due: "2030-01-01T00:00:00Z".into(),
            priority: "HIGH".into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(task.id, "feishu:remote-task");
    assert_eq!(task.priority, "HIGH");
    server.abort();
}

#[tokio::test]
async fn live_create_writes_to_the_collected_bitable() {
    let mut app = app().await;
    let upstream = Router::new().route(
        "/open-apis/bitable/v1/apps/base1/tables/tbl-submit/records",
        axum::routing::post(
            |headers: axum::http::HeaderMap, axum::Json(body): axum::Json<Value>| async move {
                assert_eq!(headers["authorization"], "Bearer user-secret");
                assert_eq!(body["fields"]["任务名称"], "Task from hub");
                assert_eq!(body["fields"]["负责人"], json!([{"id": "ou_user"}]));
                assert_eq!(body["fields"]["任务状态（由技术组长验收）"], "待执行");
                axum::Json(json!({"code":0,"data":{"record":{"record_id":"rec-new"}}}))
            },
        ),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    app.cfg.0.insert("FEISHU_MODE".into(), "live".into());
    app.cfg
        .0
        .insert("FEISHU_BITABLE_APP_TOKEN".into(), "base1".into());
    app.cfg
        .0
        .insert("FEISHU_BITABLE_SUBMIT_TABLE_ID".into(), "tbl-submit".into());
    app.cfg
        .0
        .insert("FEISHU_BASE_URL".into(), format!("http://{address}"));
    provider::save_connection(
        &app,
        "subject",
        "ou_user",
        &json!({"access_token":"user-secret","expires_at":i64::MAX}),
    )
    .await
    .unwrap();
    app.db
        .put_member(&larkai::model::Member {
            id: "ou_user".into(),
            name: "Alice".into(),
            email: "alice@example.com".into(),
        })
        .await
        .unwrap();
    let task = provider::create(
        &app,
        "subject",
        TaskInput {
            title: "Task from hub".into(),
            owner_ids: vec!["ou_user".into()],
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(task.id, "bitable:tbl-submit:rec-new");
    assert_eq!(task.source, "bitable");
    assert_eq!(task.table_id, "tbl-submit");
    assert_eq!(task.owners[0].name, "Alice");
    server.abort();
}

#[tokio::test]
async fn live_create_refuses_taskv2_when_bitable_lacks_submit_table() {
    let mut app = app().await;
    app.cfg.0.insert("FEISHU_MODE".into(), "live".into());
    app.cfg
        .0
        .insert("FEISHU_BITABLE_APP_TOKEN".into(), "base1".into());
    provider::save_connection(
        &app,
        "subject",
        "ou_user",
        &json!({"access_token":"user-secret","expires_at":i64::MAX}),
    )
    .await
    .unwrap();
    let error = provider::create(
        &app,
        "subject",
        TaskInput {
            title: "Must not create".into(),
            ..Default::default()
        },
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("FEISHU_BITABLE_SUBMIT_TABLE_ID"));
    assert!(app.db.tasks().await.unwrap().is_empty());
}

#[tokio::test]
async fn api_reports_missing_submit_table_as_bad_request() {
    let mut app = app().await;
    app.cfg.0.insert("FEISHU_MODE".into(), "live".into());
    app.cfg
        .0
        .insert("FEISHU_BITABLE_APP_TOKEN".into(), "base1".into());
    let session = Session {
        id: "submit-missing".into(),
        subject: "submit-user".into(),
        role: "member".into(),
        csrf: "submit-csrf".into(),
        ..Default::default()
    };
    save(&app, &session).await.unwrap();
    provider::save_connection(
        &app,
        "submit-user",
        "ou_user",
        &json!({"access_token":"token","expires_at":i64::MAX}),
    )
    .await
    .unwrap();
    let router = web::router(app);
    let (status, _, body) = request(
        &router,
        "POST",
        "/api/tasks",
        "larkai=submit-missing",
        "submit-csrf",
        Some(json!({"title":"No table"})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        body["error"]
            .as_str()
            .unwrap()
            .contains("FEISHU_BITABLE_SUBMIT_TABLE_ID")
    );
}

#[tokio::test]
async fn live_create_uses_tasks_table_id_as_submit_fallback() {
    let mut app = app().await;
    let upstream = Router::new().route(
        "/open-apis/bitable/v1/apps/base1/tables/tbl-tasks/records",
        axum::routing::post(|| async {
            axum::Json(json!({"code":0,"data":{"record":{"record_id":"rec-fb"}}}))
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    app.cfg.0.insert("FEISHU_MODE".into(), "live".into());
    app.cfg
        .0
        .insert("FEISHU_BITABLE_APP_TOKEN".into(), "base1".into());
    app.cfg
        .0
        .insert("FEISHU_BITABLE_TASKS_TABLE_ID".into(), "tbl-tasks".into());
    app.cfg
        .0
        .insert("FEISHU_BASE_URL".into(), format!("http://{address}"));
    provider::save_connection(
        &app,
        "subject",
        "ou_user",
        &json!({"access_token":"token","expires_at":i64::MAX}),
    )
    .await
    .unwrap();
    let task = provider::create(
        &app,
        "subject",
        TaskInput {
            title: "Fallback".into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(task.id, "bitable:tbl-tasks:rec-fb");
    assert_eq!(task.table_id, "tbl-tasks");
    server.abort();
}

#[tokio::test]
async fn refresh_members_enriches_names_from_bitable_and_self() {
    use axum::{extract::Query, routing::get};
    use std::collections::HashMap;
    let upstream = Router::new()
        .route(
            "/open-apis/contact/v3/users/find_by_department",
            get(|Query(_q): Query<HashMap<String, String>>| async {
                axum::Json(json!({"code":0,"data":{"items":[
                    {"open_id":"ou_x"},
                    {"open_id":"ou_admin"}
                ]}}))
            }),
        )
        .route(
            "/open-apis/contact/v3/departments/0/children",
            get(|| async { axum::Json(json!({"code":0,"data":{"items":[]}})) }),
        )
        .route(
            "/open-apis/im/v1/chats",
            get(|| async { axum::Json(json!({"code":0,"data":{"items":[]}})) }),
        )
        .route(
            "/open-apis/bitable/v1/apps/base1/tables",
            get(|| async { axum::Json(json!({"code":0,"data":{"items":[{"table_id":"tbl1"}]}})) }),
        )
        .route(
            "/open-apis/bitable/v1/apps/base1/tables/tbl1/records/search",
            axum::routing::post(|| async {
                axum::Json(json!({"code":0,"data":{"items":[
                    {"record_id":"r1","fields":{"任务名称":"T","负责人":[
                        {"id":"ou_x","name":"王小明","en_name":"Xiao Ming","email":"xm@example.com"},
                        {"id":"ou_bitable_only","name":"仅表格成员","email":"b@example.com"}
                    ]}}
                ],"has_more":false}}))
            }),
        )
        .route(
            "/open-apis/authen/v1/user_info",
            get(|| async {
                axum::Json(json!({"code":0,"data":{"open_id":"ou_admin","name":"管理员"}}))
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    let mut app = app().await;
    app.cfg.0.insert("FEISHU_MODE".into(), "live".into());
    app.cfg
        .0
        .insert("FEISHU_BITABLE_APP_TOKEN".into(), "base1".into());
    app.cfg
        .0
        .insert("FEISHU_BASE_URL".into(), format!("http://{address}"));
    provider::save_connection(
        &app,
        "subject",
        "ou_admin",
        &json!({"access_token":"token","expires_at":i64::MAX}),
    )
    .await
    .unwrap();
    let result = provider::refresh_members(&app, "subject").await.unwrap();
    assert_eq!(result["count"], 3);
    let members = app.db.members().await.unwrap();
    let by_id: std::collections::HashMap<_, _> =
        members.iter().map(|m| (m.id.as_str(), m)).collect();
    assert_eq!(by_id["ou_x"].name, "王小明");
    assert_eq!(by_id["ou_x"].email, "xm@example.com");
    assert_eq!(by_id["ou_admin"].name, "管理员");
    assert_eq!(by_id["ou_bitable_only"].name, "仅表格成员");
    server.abort();
}

#[tokio::test]
async fn bitable_actions_target_the_records_own_table() {
    let mut app = app().await;
    let expected = std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::from([
        "已放弃",
        "执行中",
        "暂停",
        "待执行",
        "已完成",
    ])));
    let labels = expected.clone();
    let upstream = Router::new().route(
        "/open-apis/bitable/v1/apps/base1/tables/table2/records/rec1",
        axum::routing::put(move |axum::Json(body): axum::Json<Value>| {
            let labels = labels.clone();
            async move {
                assert_eq!(body["fields"].as_object().unwrap().len(), 1);
                assert_eq!(
                    body["fields"]["任务状态（由技术组长验收）"],
                    labels.lock().unwrap().pop_front().unwrap()
                );
                axum::Json(json!({"code":0,"data":{}}))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    for (k, v) in [
        ("FEISHU_MODE", "live"),
        ("FEISHU_BITABLE_APP_TOKEN", "base1"),
        ("FEISHU_BITABLE_TASKS_TABLE_ID", "wrong-table"),
    ] {
        app.cfg.0.insert(k.into(), v.into());
    }
    app.cfg
        .0
        .insert("FEISHU_BASE_URL".into(), format!("http://{address}"));
    provider::save_connection(
        &app,
        "subject",
        "ou_user",
        &json!({"access_token":"token","expires_at":i64::MAX}),
    )
    .await
    .unwrap();
    let mut t=provider::normalize_record(&app,"table2",&json!({"record_id":"rec1","fields":{"任务名称":"Test","任务状态（由技术组长验收）":"执行中","负责人":[{"id":"ou_user","name":"Lin"}],"研发组别":["机械","电控"]}})).unwrap();
    assert_eq!(t.status, "in_progress");
    assert_eq!(t.divisions.len(), 2);
    provider::action(&app, "subject", &mut t, "cancel")
        .await
        .unwrap();
    assert_eq!(t.status, "cancelled");
    for (action, status) in [
        ("start", "in_progress"),
        ("pause", "paused"),
        ("reopen", "pending"),
        ("complete", "completed"),
    ] {
        provider::action(&app, "subject", &mut t, action)
            .await
            .unwrap();
        assert_eq!(t.status, status);
        assert_eq!(app.db.task(&t.id).await.unwrap().unwrap().status, status);
    }
    assert!(expected.lock().unwrap().is_empty());
    // Source-limited statuses must fail before any upstream request or cache write.
    t.source = "feishu".into();
    assert!(
        provider::action(&app, "subject", &mut t, "pause")
            .await
            .is_err()
    );
    assert_eq!(t.status, "completed");
    server.abort();
}
#[tokio::test]
async fn partial_sync_preserves_failed_source_data_and_reports_warnings() {
    let mut app = app().await;
    let t = provider::create(
        &app,
        "",
        TaskInput {
            title: "Cached".into(),
            priority: "HIGH".into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let mut cached: Task = t;
    cached.source = "feishu".into();
    app.db.put_task(&cached).await.unwrap();
    app.cfg.0.insert("FEISHU_MODE".into(), "live".into());
    app.cfg
        .0
        .insert("FEISHU_BASE_URL".into(), "http://127.0.0.1:1".into());
    provider::save_connection(
        &app,
        "s",
        "u",
        &json!({"access_token":"token","expires_at":i64::MAX}),
    )
    .await
    .unwrap();
    let result = provider::sync(&app, "s").await.unwrap();
    let warnings = result["warnings"].as_array().unwrap();
    for source in ["tasks:", "calendar:"] {
        assert!(
            warnings
                .iter()
                .any(|w| w.as_str().unwrap().starts_with(source))
        );
    }
    assert!(
        !warnings
            .iter()
            .any(|w| w.as_str().unwrap().starts_with("messages:"))
    );
    assert!(result["sources"].get("messages").is_none());
    assert!(app.db.task(&cached.id).await.unwrap().is_some());
}
#[test]
fn return_urls_cannot_redirect_off_site() {
    for bad in [
        "//evil.test",
        "https://evil.test",
        "/\\evil.test",
        "/tasks\n",
    ] {
        assert_eq!(larkai::auth::safe_return(bad), "/");
    }
    assert_eq!(
        larkai::auth::safe_return("/tasks?status=pending"),
        "/tasks?status=pending"
    );
}

#[tokio::test]
async fn digest_does_not_repeat_unchanged_future_deadlines() {
    let mut app = app().await;
    let mut task = provider::create(
        &app,
        "",
        TaskInput {
            title: "Future deadline".into(),
            due: "2030-01-01T00:00:00Z".into(),
            priority: "HIGH".into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    app.cfg.0.insert("FEISHU_MODE".into(), "live".into());
    // No recipients: audit only, no network delivery.
    app.cfg
        .0
        .insert("SMTP_HOST".into(), "unused.invalid".into());
    larkai::notify::digest(&app).await.unwrap();
    larkai::notify::digest(&app).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM notifications")
            .fetch_one(&app.db.0)
            .await
            .unwrap(),
        0
    );
    task.title = "Changed deadline details".into();
    app.db.put_task(&task).await.unwrap();
    larkai::notify::digest(&app).await.unwrap();
    larkai::notify::digest(&app).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM notifications")
            .fetch_one(&app.db.0)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn spa_deep_links_return_success_without_masking_api_not_found() {
    let mut app = app().await;
    let path = std::env::temp_dir().join(format!("larkai-spa-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&path).await.unwrap();
    tokio::fs::write(
        path.join("index.html"),
        "<!doctype html><div id=\"root\"></div>",
    )
    .await
    .unwrap();
    app.cfg
        .0
        .insert("FRONTEND_DIST".into(), path.to_str().unwrap().into());
    let router = web::router(app);
    assert_eq!(
        request(&router, "GET", "/timeline", "", "", None).await.0,
        StatusCode::OK
    );
    let (status, _, body) = request(&router, "GET", "/api/nonexistent", "", "", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "Unknown API endpoint");
    tokio::fs::remove_dir_all(path).await.unwrap();
}

#[tokio::test]
async fn feishu_pagination_and_permission_errors() {
    use axum::{Json, extract::Query, routing::get};
    use std::collections::HashMap;
    let upstream = Router::new()
        .route("/open-apis/items", get(|Query(q): Query<HashMap<String,String>>| async move {
            assert_eq!(q.get("page_size").map(String::as_str), Some("50"));
            if let Some(cursor) = q.get("page_token") {
                assert_eq!(cursor, "next /+&");
                Json(json!({"code":0,"data":{"items":[2],"has_more":false}}))
            } else {
                Json(json!({"code":0,"data":{"items":[1],"has_more":true,"page_token":"next /+&"}}))
            }
        }))
        .route("/open-apis/denied", get(|| async {
            (StatusCode::BAD_REQUEST, Json(json!({"code":99991679,"error":{"permission_violations":[{"subject":"im:message.history:readonly"}]}})))
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    let mut app = app().await;
    app.cfg.0.insert("FEISHU_BASE_URL".into(), base);
    assert_eq!(
        provider::pages(&app, "/items", "items", "test", false)
            .await
            .unwrap(),
        vec![json!(1), json!(2)]
    );
    let error = provider::pages(&app, "/denied", "items", "test", false)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("im:message.history:readonly"));
    assert!(error.to_string().contains("reconnect Feishu"));
    let error: larkai::Error = error.into();
    assert_eq!(error.0, StatusCode::BAD_GATEWAY);
    app.cfg.0.insert(
        "FEISHU_SCOPES".into(),
        "task:task:read offline_access im:message.history:readonly im:message.group_msg:get_as_user".into(),
    );
    let scopes = app.cfg.feishu_scopes();
    assert!(!scopes.contains("im:message"));
    for scope in [
        "task:task:read",
        "contact:contact.base:readonly",
        "base:field:read",
    ] {
        assert!(scopes.split_whitespace().any(|s| s == scope));
    }
    server.abort();
}

#[tokio::test]
async fn bootstrap_keeps_page_authorization_and_exposes_timings() {
    let app = app().await;
    let router = web::router(app.clone());
    let (status, headers, body) =
        request(&router, "GET", "/api/bootstrap?page=/tasks", "", "", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["/tasks?q=&status="]["status"], 401);
    assert_eq!(headers["cache-control"], "no-store");
    let timing = headers["server-timing"].to_str().unwrap();
    for name in ["auth;dur=", "handler;dur=", "total;dur=", "db;dur="] {
        assert!(timing.contains(name));
    }
    uuid::Uuid::parse_str(headers["x-request-id"].to_str().unwrap()).unwrap();
    let (cookie, _) = login(&router).await;
    let (_, _, body) = request(
        &router,
        "GET",
        "/api/bootstrap?page=/tasks",
        &cookie,
        "",
        None,
    )
    .await;
    assert!(body["data"]["/tasks?q=&status="]["data"].is_array());
    let session = Session {
        id: "member-bootstrap".into(),
        subject: "member".into(),
        role: "member".into(),
        ..Default::default()
    };
    save(&app, &session).await.unwrap();
    let (_, _, body) = request(
        &router,
        "GET",
        "/api/bootstrap?page=/settings",
        "larkai=member-bootstrap",
        "",
        None,
    )
    .await;
    assert_eq!(body["data"]["/settings"]["status"], 403);
}

#[tokio::test]
async fn only_existing_assets_receive_immutable_private_caching() {
    let dir = std::env::temp_dir().join(format!("larkai-assets-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(dir.join("assets")).await.unwrap();
    tokio::fs::write(dir.join("assets/test-12345678.js"), "export default 1")
        .await
        .unwrap();
    tokio::fs::write(dir.join("index.html"), "<html>test</html>")
        .await
        .unwrap();
    let mut app = app().await;
    app.cfg
        .0
        .insert("FRONTEND_DIST".into(), dir.to_str().unwrap().into());
    let router = web::router(app);
    let (status, headers, _) =
        request(&router, "GET", "/assets/test-12345678.js", "", "", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers["cache-control"],
        "private, max-age=31536000, immutable"
    );
    assert!(!headers.contains_key("set-cookie"));
    let (status, headers, _) = request(&router, "GET", "/assets/missing.js", "", "", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(headers["cache-control"], "no-store");
    let (_, headers, _) = request(&router, "GET", "/tasks", "", "", None).await;
    assert_eq!(headers["cache-control"], "no-store");
    tokio::fs::remove_dir_all(dir).await.unwrap();
}

#[tokio::test]
async fn relationships_validate_cycles_conflicts_and_auth_without_changing_task_fields() {
    let app = app().await;
    let router = web::router(app.clone());
    let (cookie, csrf) = login(&router).await;
    let mut tasks = Vec::new();
    for title in [
        "Test parent",
        "Test design",
        "Test assembly",
        "Test verification",
    ] {
        let (_, _, task) = request(
            &router,
            "POST",
            "/api/tasks",
            &cookie,
            &csrf,
            Some(json!({"title":title,"description":"Keep this unchanged"})),
        )
        .await;
        tasks.push(serde_json::from_value::<Task>(task).unwrap());
    }
    let p = &tasks[0].id;
    let a = &tasks[1].id;
    let b = &tasks[2].id;
    let c = &tasks[3].id;
    let input = |parent: Vec<&String>, deps: Vec<&String>| json!({"parent_ids":parent,"dependency_ids":deps,"expected_parent_ids":[],"expected_dependency_ids":[]});
    let path = format!("/api/tasks/{b}/relationships");
    assert_eq!(
        request(
            &router,
            "POST",
            &path,
            &cookie,
            "wrong",
            Some(input(vec![p], vec![a]))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &router,
            "POST",
            &path,
            "",
            "",
            Some(input(vec![p], vec![a]))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, _, saved) = request(
        &router,
        "POST",
        &path,
        &cookie,
        &csrf,
        Some(input(vec![p], vec![a])),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["dependency_ids"], json!([a]));
    assert_eq!(saved["parent_ids"], json!([p]));
    assert_eq!(saved["description"], "Keep this unchanged");
    assert_eq!(saved["status"], "pending");
    assert_eq!(
        request(
            &router,
            "POST",
            &path,
            &cookie,
            &csrf,
            Some(input(vec![], vec![]))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        request(
            &router,
            "POST",
            &format!("/api/tasks/{c}/relationships"),
            &cookie,
            &csrf,
            Some(input(vec![], vec![b]))
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, _, error) = request(
        &router,
        "POST",
        &format!("/api/tasks/{a}/relationships"),
        &cookie,
        &csrf,
        Some(input(vec![], vec![c])),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(error["error"].as_str().unwrap().contains("cycle"));
    assert_eq!(
        request(
            &router,
            "POST",
            &format!("/api/tasks/{p}/relationships"),
            &cookie,
            &csrf,
            Some(input(vec![b], vec![]))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &router,
            "POST",
            &format!("/api/tasks/{a}/relationships"),
            &cookie,
            &csrf,
            Some(input(vec![], vec![a]))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let unknown = "mock:unknown".to_string();
    assert_eq!(
        request(
            &router,
            "POST",
            &format!("/api/tasks/{a}/relationships"),
            &cookie,
            &csrf,
            Some(input(vec![], vec![&unknown]))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let cleared = json!({"parent_ids":[],"dependency_ids":[],"expected_parent_ids":[p],"expected_dependency_ids":[a]});
    assert_eq!(
        request(&router, "POST", &path, &cookie, &csrf, Some(cleared))
            .await
            .0,
        StatusCode::OK
    );
    assert!(
        app.db
            .task(a)
            .await
            .unwrap()
            .unwrap()
            .dependency_ids
            .is_empty()
    );
}

#[tokio::test]
async fn imported_relationships_keep_unnamed_tasks_and_detect_external_cycles() {
    let app = app().await;
    let row = json!({"record_id":"a","fields":{"任务名称":null,"任务ID":"017","父记录":[{"record_ids":["parent"]}],"前置/依赖":["b",{"id":"b"}]}});
    let a = provider::normalize_record(&app, "table", &row).unwrap();
    assert_eq!(a.title, "未命名任务 #017");
    assert_eq!(a.parent_ids, vec!["bitable:table:parent"]);
    assert_eq!(a.dependency_ids, vec!["bitable:table:b"]);
    let b = provider::normalize_record(
        &app,
        "table",
        &json!({"record_id":"b","fields":{"任务名称":"Test B","前置/依赖":[{"record_ids":["a"]}]}}),
    )
    .unwrap();
    let c = provider::normalize_record(
        &app,
        "table",
        &json!({"record_id":"c","fields":{"任务名称":"Test C","前置/依赖":["b"]}}),
    )
    .unwrap();
    assert_eq!(
        larkai::graph::cycle_members(&[a.clone(), b, c], false),
        vec!["bitable:table:a", "bitable:table:b"]
    );
    let mut old = serde_json::to_value(a).unwrap();
    old.as_object_mut().unwrap().remove("parent_ids");
    old.as_object_mut().unwrap().remove("dependency_ids");
    let task: Task = serde_json::from_value(old).unwrap();
    assert!(task.parent_ids.is_empty() && task.dependency_ids.is_empty());
}

#[tokio::test]
async fn relationship_writeback_only_updates_changed_link_fields() {
    let mut app = app().await;
    let upstream = Router::new().route(
        "/open-apis/bitable/v1/apps/base1/tables/table2/records/rec1",
        axum::routing::put(|axum::Json(body): axum::Json<Value>| async move {
            assert_eq!(body, json!({"fields":{"前置/依赖":["rec2","rec3"]}}));
            axum::Json(json!({"code":0,"data":{}}))
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    app.cfg.0.insert("FEISHU_MODE".into(), "live".into());
    app.cfg
        .0
        .insert("FEISHU_BITABLE_APP_TOKEN".into(), "base1".into());
    app.cfg
        .0
        .insert("FEISHU_BASE_URL".into(), format!("http://{address}"));
    provider::save_connection(
        &app,
        "subject",
        "ou_user",
        &json!({"access_token":"token","expires_at":i64::MAX}),
    )
    .await
    .unwrap();
    let mut task = provider::normalize_record(
        &app,
        "table2",
        &json!({"record_id":"rec1","fields":{"任务名称":"Test","父记录":["parent"]}}),
    )
    .unwrap();
    let input = larkai::graph::Relationships {
        parent_ids: task.parent_ids.clone(),
        dependency_ids: vec!["bitable:table2:rec2".into(), "bitable:table2:rec3".into()],
        expected_parent_ids: task.parent_ids.clone(),
        expected_dependency_ids: vec![],
    };
    provider::save_relationships(&app, "subject", &mut task, &input)
        .await
        .unwrap();
    assert_eq!(task.dependency_ids.len(), 2);
    server.abort();
}

#[tokio::test]
async fn live_relationship_validation_reads_external_changes_before_writing() {
    let mut app = app().await;
    let a = provider::normalize_record(
        &app,
        "table",
        &json!({"record_id":"a","fields":{"任务名称":"Test A"}}),
    )
    .unwrap();
    app.db.put_task(&a).await.unwrap();
    // The cache has no links; the live table has B depending on A. Adding A->B
    // must be rejected using the fresh graph, before any upstream PUT occurs.
    let upstream = Router::new().route(
        "/open-apis/bitable/v1/apps/base/tables/table/records/search",
        axum::routing::post(|| async {
            axum::Json(json!({"code":0,"data":{"items":[
            {"record_id":"a","fields":{"任务名称":"Test A"}},
            {"record_id":"b","fields":{"任务名称":"Test B","前置/依赖":[{"record_ids":["a"]}]}}
        ],"has_more":false}}))
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    app.cfg.0.insert("FEISHU_MODE".into(), "live".into());
    app.cfg
        .0
        .insert("FEISHU_BITABLE_APP_TOKEN".into(), "base".into());
    app.cfg
        .0
        .insert("FEISHU_BASE_URL".into(), format!("http://{address}"));
    let session = Session {
        id: "graph-session".into(),
        subject: "graph-user".into(),
        role: "member".into(),
        csrf: "graph-csrf".into(),
        ..Default::default()
    };
    save(&app, &session).await.unwrap();
    provider::save_connection(
        &app,
        "graph-user",
        "ou_graph",
        &json!({"access_token":"token","expires_at":i64::MAX}),
    )
    .await
    .unwrap();
    let router = web::router(app.clone());
    let (status,_,error) = request(&router,"POST","/api/tasks/bitable:table:a/relationships","larkai=graph-session","graph-csrf",Some(json!({"parent_ids":[],"dependency_ids":["bitable:table:b"],"expected_parent_ids":[],"expected_dependency_ids":[]}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert!(error["error"].as_str().unwrap().contains("cycle"));
    assert!(
        app.db
            .task(&a.id)
            .await
            .unwrap()
            .unwrap()
            .dependency_ids
            .is_empty()
    );
    server.abort();
}
