export interface SessionRow {
  id: number
  name: string
  coworkerType: string | null
  status: string | null
  description: string | null
  philosophy: string | null
  visual_description: string | null
  created_at: Date
}

export interface ConfigRow {
  key: string
  value: string
}

export interface MessageRow {
  id: number
  from_name: string
  to_name: string
  body: string
  read: boolean
  injected: boolean
  notified?: boolean
  created_at: Date
}

export interface CronJobRow {
  id: number
  name: string
  session_name: string
  schedule: string
  timezone: string | null
  message: string
  enabled: boolean
  created_at: Date
  last_run: Date | null
}

export interface CronHistoryRow {
  id: number
  cron_job_id: number
  executed_at: Date
  success: boolean
  error_message: string | null
}

export interface CronRequestRow {
  id: number
  name: string
  session_name: string
  schedule: string
  timezone: string | null
  message: string
  status: 'pending' | 'approved' | 'rejected'
  requested_at: Date
  reviewed_at: Date | null
  reviewed_by: string | null
  reviewer_notes: string | null
}

export interface TaskRow {
  id: number
  title: string
  description: string
  assignee: string | null
  column: string
  dependencies: number[]
  created_at: Date
  updated_at: Date
}

export interface TaskHistoryRow {
  id: number
  task_id: number
  from_column: string | null
  to_column: string
  moved_at: Date
}
