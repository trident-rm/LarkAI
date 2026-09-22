# Collection

Connect Feishu in the UI, then use **Sync** as an admin. `make collect` runs a one-shot collection using the first stored connection. `RM_AUTO_COLLECT_SECONDS` enables the same collection loop in the server (zero disables it).

Sources:

- Task-v2 `my_tasks`, with full pagination. Upserts preserve local priority, divisions and the cancelled marker; one user's view never prunes another user's cached tasks.
- Every table in the configured Bitable, resolved from `FEISHU_BITABLE_APP_TOKEN` or `FEISHU_WIKI_NODE_TOKEN`. Configure field names in `.env` to match your base. Task IDs include the source table ID.

Each sync also reads the person field (`FEISHU_BITABLE_OWNER_FIELD`, default `负责人`) and refreshes the member directory with the display names the base stores, so members are shown by name instead of `ou_...` ids even when the contact API is scope-limited. Run **Refresh members** for the same enrichment without waiting for a sync.
- Calendar events for `FEISHU_CALENDAR_ID`, or the first reachable calendar when unset.

Each source reports failure independently. Failed sources retain their previous cache; successful Bitable/calendar snapshots replace their source transactionally. The dashboard shows the last collection time and any warnings. Detailed errors go to server logs. The timeline derives task events from current tasks, so local completion/deletion immediately updates it.

**Members** refreshes the root directory, child departments and chat membership, including reachable external members. The task form uses cached member IDs; workload counts each explicit owner rather than splitting display names. Permissions limit what the connected user can collect.

Collection and mutations share a process-local lock. Use one Axum instance per database. Reconnect Feishu after granting additional scopes. There is no Python collection subprocess or old mock-state file in this implementation.

Message collection is disabled; `FEISHU_CHAT_IDS` only limits chat membership lookup during member refresh. Message-read scopes are not requested.
