# Interactive tasks

The React task board creates tasks, updates their status and deletes tasks through JSON APIs. Task forms support a title, description, timezone-aware deadline, priority, multiple assignees, divisions, category and remark. Search/filter/grouping is available by status, source and division.

## Source mapping

When a Bitable is configured, creation uses `POST /bitable/v1/apps/{base}/tables/{table}/records` with the table from `FEISHU_BITABLE_SUBMIT_TABLE_ID` (or the legacy `FEISHU_BITABLE_TASKS_TABLE_ID` fallback). Column names come from `FEISHU_BITABLE_*_FIELD`. Categories and divisions come from the table's field options when available. A missing submit table id is refused with an actionable error instead of silently creating a task in a different system.

When no Bitable is configured at all, creation uses `POST /task/v2/tasks`. Deadlines use milliseconds in a string-valued `due.timestamp`; members carry `role=assignee`. Priority is local because task-v2 has no priority field. Completion uses PATCH with `task.completed_at` and `update_fields=["completed_at"]`. Cancellation also completes the upstream task and retains a local cancelled marker.

Bitable completion/cancellation uses PUT to the original record's table, with status `已完成`/`已放弃`. Deletion uses the source-specific DELETE endpoint and requires admin access. Bitable records must use the configured task name field to be mirrored; customize the field mapping for your base rather than relying on heuristic title detection.

All actions require a connected Feishu account and CSRF token; admin actions also check role. Authorization failures never replay task submissions after reconnecting. Local state changes only after an upstream operation succeeds. Every successful lifecycle action records a notification audit entry. Mock mode implements the same API locally with no remote calls.

## V1 status controls

The status selector on task cards sends `start`, `pause`, `reopen`, `complete` or `cancel` to the existing action route. For Bitable these write only the original table's configured status field, using `执行中`, `暂停`, the configured default status (normally `待执行`), `已完成` and `已放弃`. The cached task changes only after a successful upstream response. All changes retain CSRF/connection checks and notification auditing.

Task-v2 retains completion/cancellation only; unsupported intermediate transitions are rejected before an upstream request. The My Tasks filter uses the session's connected Feishu `open_id`, never a display name. Omitting assignees creates a task for the connected user; selecting assignees allows assignment to other members.
