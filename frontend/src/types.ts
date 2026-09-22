export interface Member {
  id: string;
  name: string;
  email: string;
}
export interface Task {
  parent_ids?: string[];
  dependency_ids?: string[];
  id: string;
  remote_id: string;
  source: string;
  table_id: string;
  title: string;
  description: string;
  due: string;
  priority: string;
  status: string;
  owners: Member[];
  divisions: string[];
  category: string;
  url: string;
  updated_at: string;
}
export interface Event {
  id: string;
  source: string;
  title: string;
  description: string;
  ts: string;
  author: string;
  url: string;
  importance: number;
  tags: string[];
}
export interface Stats {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  cancelled: number;
  overdue: number;
  next_deadlines: Task[];
}
export interface Session {
  user: { name: string; role: string; open_id: string } | null;
  csrf_token: string;
  connected: boolean;
  mode: string;
  oidc: boolean;
  team_name: string;
}
export interface Sync {
  last_sync: string;
  sources: Record<string, number>;
  warnings: string[];
}
export interface Dashboard {
  tasks: Task[];
  stats: Stats;
  important: Event[];
  members: Member[];
  sync: Sync | null;
}
export interface Workload {
  members: {
    id: string;
    name: string;
    email: string;
    active: number;
    stats: Stats;
    tasks: Task[];
  }[];
  unassigned: number;
}
export interface Notification {
  id: number;
  created_at: string;
  subject: string;
  body: string;
  recipients: string;
  status: string;
  error: string;
}
export interface Settings {
  email_recipients: string;
  smtp_configured: boolean;
  smtp_host: string;
  mode: string;
  auto_collect_seconds: number;
}

export interface PageProps {
  session: Session;
  revision: number;
  mutate: (path: string, body?: unknown, method?: string) => Promise<boolean>;
  busy: boolean;
}
