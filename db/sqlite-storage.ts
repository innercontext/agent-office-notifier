import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { AgentOfficeStorageBase } from './storage-base.js'
import type {
  SessionRow,
  ConfigRow,
  MessageRow,
  CronJobRow,
  CronHistoryRow,
  CronRequestRow,
  TaskRow,
  TaskHistoryRow,
} from './types.js'

export class AgentOfficeSqliteStorage extends AgentOfficeStorageBase {
  constructor(private db: Database.Database) {
    super()
  }

  async close(): Promise<void> {
    this.db.close()
  }

  async begin<T>(callback: (tx: import('./storage.js').AgentOfficeStorage) => Promise<T>): Promise<T> {
    // Manual transaction handling for async support
    this.db.exec('BEGIN')
    const txStorage = new AgentOfficeSqliteStorage(this.db)

    try {
      const result = await callback(txStorage)
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  // Sessions
  async listSessions(): Promise<SessionRow[]> {
    const stmt = this.db.prepare(`
      SELECT id, name, coworkerType, status, description, philosophy, visual_description, created_at
      FROM sessions
      ORDER BY created_at DESC
    `)
    const rows = stmt.all() as Array<{
      id: number
      name: string
      coworkerType: string | null
      status: string | null
      description: string | null
      philosophy: string | null
      visual_description: string | null
      created_at: string
    }>
    return rows.map(row => ({
      ...row,
      created_at: new Date(row.created_at),
    }))
  }

  async getSessionByName(name: string): Promise<SessionRow | null> {
    const stmt = this.db.prepare(`
      SELECT id, name, coworkerType, status, description, philosophy, visual_description, created_at
      FROM sessions WHERE name = ?
    `)
    const row = stmt.get(name) as any
    if (!row) return null
    return {
      ...row,
      created_at: new Date(row.created_at),
    }
  }

  async getSessionIdByName(name: string): Promise<number | null> {
    const stmt = this.db.prepare(`SELECT id FROM sessions WHERE name = ?`)
    const row = stmt.get(name) as { id: number } | undefined
    return row?.id ?? null
  }

  async createSession(name: string, coworkerType: string): Promise<SessionRow> {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (name, coworkerType)
      VALUES (?, ?)
      RETURNING id, name, coworkerType, status, created_at
    `)
    const row = stmt.get(name, coworkerType) as any
    return {
      ...row,
      created_at: new Date(row.created_at),
    }
  }

  async deleteSession(id: number): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM sessions WHERE id = ?`)
    stmt.run(id)
  }

  async regenerateAgentCode(name: string): Promise<SessionRow> {
    const newCode = randomUUID()
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET agent_code = ?
      WHERE name = ?
      RETURNING id, name, session_id, agent_code, agent, status, created_at
    `)
    const row = stmt.get(newCode, name) as any
    return {
      ...row,
      created_at: new Date(row.created_at),
    }
  }

  async updateSession(
    name: string,
    updates: Partial<Pick<SessionRow, 'coworkerType' | 'status' | 'description' | 'philosophy' | 'visual_description'>>
  ): Promise<SessionRow | null> {
    // Get current session
    const current = this.getSessionByName(name)
    if (!current) {
      return null
    }

    // Build dynamic update
    const setParts: string[] = []
    const values: any[] = []

    if (updates.coworkerType !== undefined) {
      setParts.push('coworkerType = ?')
      values.push(updates.coworkerType)
    }
    if (updates.status !== undefined) {
      setParts.push('status = ?')
      values.push(updates.status)
    }
    if (updates.description !== undefined) {
      setParts.push('description = ?')
      values.push(updates.description)
    }
    if (updates.philosophy !== undefined) {
      setParts.push('philosophy = ?')
      values.push(updates.philosophy)
    }
    if (updates.visual_description !== undefined) {
      setParts.push('visual_description = ?')
      values.push(updates.visual_description)
    }

    if (setParts.length === 0) {
      return current
    }

    values.push(name)
    const sql = `UPDATE sessions SET ${setParts.join(', ')} WHERE name = ? RETURNING id, name, coworkerType, status, description, philosophy, visual_description, created_at`
    const stmt = this.db.prepare(sql)
    const row = stmt.get(...values) as any
    if (!row) return null

    return {
      ...row,
      created_at: new Date(row.created_at),
    }
  }

  async sessionExists(name: string): Promise<boolean> {
    const stmt = this.db.prepare(`SELECT id FROM sessions WHERE name = ?`)
    const row = stmt.get(name) as { id: number } | undefined
    return !!row
  }

  // Config
  async getAllConfig(): Promise<ConfigRow[]> {
    const stmt = this.db.prepare(`SELECT key, value FROM config`)
    return stmt.all() as ConfigRow[]
  }

  async getConfig(key: string): Promise<string | null> {
    const stmt = this.db.prepare(`SELECT value FROM config WHERE key = ?`)
    const row = stmt.get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  async setConfig(key: string, value: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO config (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `)
    stmt.run(key, value)
  }

  // Messages
  async listMessagesForRecipient(
    name: string,
    filters?: { unread?: boolean; olderThanHours?: number; notified?: boolean }
  ): Promise<MessageRow[]> {
    let whereClauses: string[] = [`to_name = ?`]
    let params: any[] = [name]
    if (filters?.unread) {
      whereClauses.push(`read = 0`)
    }
    if (filters?.notified === false) {
      whereClauses.push(`notified != 1`)
    }
    if (filters?.olderThanHours !== undefined) {
      const hours = filters.olderThanHours
      whereClauses.push(`created_at < datetime('now', '-${hours} hours')`)
    }
    const where = whereClauses.join(' AND ')
    const sql = `SELECT id, from_name, to_name, body, read, injected, created_at, notified
                 FROM messages
                 WHERE ${where}
                 ORDER BY created_at DESC`
    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as Array<{
      id: number
      from_name: string
      to_name: string
      body: string
      read: number
      injected: number
      notified: number
      created_at: string
    }>
    return rows.map(row => ({
      ...row,
      read: !!row.read,
      injected: !!row.injected,
      notified: !!row.notified,
      created_at: new Date(row.created_at + 'Z'),
    }))
  }

  async listMessagesFromSender(name: string): Promise<MessageRow[]> {
    const stmt = this.db.prepare(`
      SELECT id, from_name, to_name, body, read, injected, created_at
      FROM messages
      WHERE from_name = ?
      ORDER BY created_at DESC
    `)
    const rows = stmt.all(name) as Array<{
      id: number
      from_name: string
      to_name: string
      body: string
      read: boolean
      injected: boolean
      created_at: string
    }>
    return rows.map(row => ({
      ...row,
      created_at: new Date(row.created_at + 'Z'), // Treat SQLite datetime as UTC
    }))
  }

  async listMessagesBetween(
    coworker1: string,
    coworker2: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<MessageRow[]> {
    let sql = `
      SELECT id, from_name, to_name, body, read, injected, created_at
      FROM messages
      WHERE ((from_name = ? AND to_name = ?) OR (from_name = ? AND to_name = ?))
    `
    const params: any[] = [coworker1, coworker2, coworker2, coworker1]

    if (startTime) {
      sql += ` AND created_at >= ?`
      params.push(startTime.toISOString())
    }
    if (endTime) {
      sql += ` AND created_at <= ?`
      params.push(endTime.toISOString())
    }

    sql += ` ORDER BY created_at ASC`

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as Array<{
      id: number
      from_name: string
      to_name: string
      body: string
      read: boolean
      injected: boolean
      created_at: string
    }>
    return rows.map(row => ({
      ...row,
      created_at: new Date(row.created_at + 'Z'), // Treat SQLite datetime as UTC
    }))
  }

  async countUnreadBySender(recipientName: string): Promise<Map<string, number>> {
    const stmt = this.db.prepare(`
      SELECT from_name, COUNT(*) as count
      FROM messages
      WHERE to_name = ? AND read = FALSE
      GROUP BY from_name
    `)
    const rows = stmt.all(recipientName) as Array<{ from_name: string; count: number }>
    const result = new Map<string, number>()
    for (const row of rows) {
      result.set(row.from_name, row.count)
    }
    return result
  }

  async lastMessageAtByCoworker(humanName: string): Promise<Map<string, Date>> {
    const stmt = this.db.prepare(`
      SELECT
        CASE WHEN from_name = ? THEN to_name ELSE from_name END AS coworker,
        MAX(created_at) AS last_at
      FROM messages
      WHERE from_name = ? OR to_name = ?
      GROUP BY coworker
    `)
    const rows = stmt.all(humanName, humanName, humanName) as Array<{ coworker: string; last_at: string }>
    const result = new Map<string, Date>()
    for (const row of rows) {
      result.set(row.coworker, new Date(row.last_at + 'Z'))
    }
    return result
  }

  async createMessageImpl(from: string, to: string, body: string): Promise<MessageRow> {
    const stmt = this.db.prepare(`
      INSERT INTO messages (from_name, to_name, body)
      VALUES (?, ?, ?)
      RETURNING id, from_name, to_name, body, read, injected, created_at
    `)
    const row = stmt.get(from, to, body) as any
    return {
      ...row,
      created_at: new Date(row.created_at + 'Z'), // Treat SQLite datetime as UTC
    }
  }

  async markMessageAsRead(id: number): Promise<MessageRow | null> {
    const stmt = this.db.prepare(`
      UPDATE messages SET read = TRUE WHERE id = ?
      RETURNING id, from_name, to_name, body, read, injected, created_at
    `)
    const row = stmt.get(id) as any
    if (!row) return null
    return {
      ...row,
      created_at: new Date(row.created_at + 'Z'), // Treat SQLite datetime as UTC
    }
  }

  async markMessageAsInjected(id: number): Promise<void> {
    const stmt = this.db.prepare(`UPDATE messages SET injected = TRUE WHERE id = ?`)
    stmt.run(id)
  }

  async markMessagesAsNotified(ids: number[]): Promise<void> {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(',')
    const stmt = this.db.prepare(`UPDATE messages SET notified = 1 WHERE id IN (${placeholders})`)
    stmt.run(...ids)
  }

  async deleteMessagesForCoworker(name: string): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM messages WHERE from_name = ? OR to_name = ?`)
    stmt.run(name, name)
  }

  // Cron Jobs
  async listCronJobs(): Promise<CronJobRow[]> {
    const stmt = this.db.prepare(`
      SELECT id, name, session_name, schedule, timezone, message, enabled, created_at, last_run
      FROM cron_jobs
      ORDER BY name
    `)
    const rows = stmt.all() as Array<{
      id: number
      name: string
      session_name: string
      schedule: string
      timezone: string | null
      message: string
      enabled: boolean
      created_at: string
      last_run: string | null
    }>
    return rows.map(row => ({
      ...row,
      created_at: new Date(row.created_at),
      last_run: row.last_run ? new Date(row.last_run) : null,
    }))
  }

  async listCronJobsForSession(sessionName: string): Promise<CronJobRow[]> {
    const stmt = this.db.prepare(`
      SELECT id, name, session_name, schedule, timezone, message, enabled, created_at, last_run
      FROM cron_jobs
      WHERE session_name = ?
      ORDER BY name
    `)
    const rows = stmt.all(sessionName) as Array<{
      id: number
      name: string
      session_name: string
      schedule: string
      timezone: string | null
      message: string
      enabled: boolean
      created_at: string
      last_run: string | null
    }>
    return rows.map(row => ({
      ...row,
      created_at: new Date(row.created_at),
      last_run: row.last_run ? new Date(row.last_run) : null,
    }))
  }

  async getCronJobById(id: number): Promise<CronJobRow | null> {
    const stmt = this.db.prepare(`
      SELECT id, name, session_name, schedule, timezone, message, enabled, created_at, last_run
      FROM cron_jobs WHERE id = ?
    `)
    const row = stmt.get(id) as any
    if (!row) return null
    return {
      ...row,
      created_at: new Date(row.created_at),
      last_run: row.last_run ? new Date(row.last_run) : null,
    }
  }

  async getCronJobByNameAndSession(name: string, sessionName: string): Promise<CronJobRow | null> {
    const stmt = this.db.prepare(`
      SELECT id, name, session_name, schedule, timezone, message, enabled, created_at, last_run
      FROM cron_jobs WHERE name = ? AND session_name = ?
    `)
    const row = stmt.get(name, sessionName) as any
    if (!row) return null
    return {
      ...row,
      created_at: new Date(row.created_at),
      last_run: row.last_run ? new Date(row.last_run) : null,
    }
  }

  async createCronJob(
    name: string,
    sessionName: string,
    schedule: string,
    timezone: string,
    message: string
  ): Promise<CronJobRow> {
    const stmt = this.db.prepare(`
      INSERT INTO cron_jobs (name, session_name, schedule, timezone, message)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id, name, session_name, schedule, timezone, message, enabled, created_at, last_run
    `)
    const row = stmt.get(name, sessionName, schedule, timezone, message) as any
    return {
      ...row,
      created_at: new Date(row.created_at),
      last_run: row.last_run ? new Date(row.last_run) : null,
    }
  }

  async deleteCronJob(id: number): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM cron_jobs WHERE id = ?`)
    stmt.run(id)
  }

  async enableCronJob(id: number): Promise<void> {
    const stmt = this.db.prepare(`UPDATE cron_jobs SET enabled = TRUE WHERE id = ?`)
    stmt.run(id)
  }

  async disableCronJob(id: number): Promise<void> {
    const stmt = this.db.prepare(`UPDATE cron_jobs SET enabled = FALSE WHERE id = ?`)
    stmt.run(id)
  }

  async updateCronJobLastRun(id: number, lastRun: Date): Promise<void> {
    const stmt = this.db.prepare(`UPDATE cron_jobs SET last_run = ? WHERE id = ?`)
    stmt.run(lastRun.toISOString(), id)
  }

  async cronJobExistsForSession(name: string, sessionName: string): Promise<boolean> {
    const stmt = this.db.prepare(`SELECT id FROM cron_jobs WHERE name = ? AND session_name = ?`)
    const row = stmt.get(name, sessionName) as { id: number } | undefined
    return !!row
  }

  // Cron History
  async listCronHistory(cronJobId: number, limit: number): Promise<CronHistoryRow[]> {
    const stmt = this.db.prepare(`
      SELECT id, cron_job_id, executed_at, success, error_message
      FROM cron_history
      WHERE cron_job_id = ?
      ORDER BY executed_at DESC
      LIMIT ?
    `)
    const rows = stmt.all(cronJobId, limit) as Array<{
      id: number
      cron_job_id: number
      executed_at: string
      success: boolean
      error_message: string | null
    }>
    return rows.map(row => ({
      ...row,
      executed_at: new Date(row.executed_at),
    }))
  }

  async createCronHistory(cronJobId: number, executedAt: Date, success: boolean, errorMessage?: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO cron_history (cron_job_id, executed_at, success, error_message)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(cronJobId, executedAt.toISOString(), success ? 1 : 0, errorMessage ?? null)
  }

  // Cron Requests
  async listCronRequests(filters?: { status?: string; sessionName?: string }): Promise<CronRequestRow[]> {
    let query = `
      SELECT id, name, session_name, schedule, timezone, message, status, requested_at, reviewed_at, reviewed_by, reviewer_notes
      FROM cron_requests
      WHERE 1=1
    `
    const params: unknown[] = []

    if (filters?.status) {
      query += ` AND status = ?`
      params.push(filters.status)
    }
    if (filters?.sessionName) {
      query += ` AND session_name = ?`
      params.push(filters.sessionName)
    }

    query += ` ORDER BY requested_at DESC`

    const stmt = this.db.prepare(query)
    const rows = stmt.all(...params) as Array<{
      id: number
      name: string
      session_name: string
      schedule: string
      timezone: string | null
      message: string
      status: 'pending' | 'approved' | 'rejected'
      requested_at: string
      reviewed_at: string | null
      reviewed_by: string | null
      reviewer_notes: string | null
    }>
    return rows.map(row => ({
      ...row,
      requested_at: new Date(row.requested_at),
      reviewed_at: row.reviewed_at ? new Date(row.reviewed_at) : null,
    }))
  }

  async getCronRequestById(id: number): Promise<CronRequestRow | null> {
    const stmt = this.db.prepare(`
      SELECT id, name, session_name, schedule, timezone, message, status, requested_at, reviewed_at, reviewed_by, reviewer_notes
      FROM cron_requests WHERE id = ?
    `)
    const row = stmt.get(id) as any
    if (!row) return null
    return {
      ...row,
      requested_at: new Date(row.requested_at),
      reviewed_at: row.reviewed_at ? new Date(row.reviewed_at) : null,
    }
  }

  async createCronRequest(
    name: string,
    sessionName: string,
    schedule: string,
    timezone: string,
    message: string
  ): Promise<CronRequestRow> {
    const stmt = this.db.prepare(`
      INSERT INTO cron_requests (name, session_name, schedule, timezone, message)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id, name, session_name, schedule, timezone, message, status, requested_at, reviewed_at, reviewed_by, reviewer_notes
    `)
    const row = stmt.get(name, sessionName, schedule, timezone, message) as any
    return {
      ...row,
      requested_at: new Date(row.requested_at),
      reviewed_at: row.reviewed_at ? new Date(row.reviewed_at) : null,
    }
  }

  async updateCronRequestStatus(
    id: number,
    status: 'approved' | 'rejected',
    reviewedBy: string,
    reviewerNotes?: string
  ): Promise<CronRequestRow | null> {
    const stmt = this.db.prepare(`
      UPDATE cron_requests
      SET status = ?, reviewed_at = ?, reviewed_by = ?, reviewer_notes = ?
      WHERE id = ?
      RETURNING id, name, session_name, schedule, timezone, message, status, requested_at, reviewed_at, reviewed_by, reviewer_notes
    `)
    const row = stmt.get(status, new Date().toISOString(), reviewedBy, reviewerNotes ?? null, id) as any
    if (!row) return null
    return {
      ...row,
      requested_at: new Date(row.requested_at),
      reviewed_at: row.reviewed_at ? new Date(row.reviewed_at) : null,
    }
  }

  async deleteCronRequest(id: number): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM cron_requests WHERE id = ?`)
    stmt.run(id)
  }

  // Tasks
  async listTasks(): Promise<TaskRow[]> {
    const stmt = this.db.prepare(`
      SELECT id, title, description, assignee, column_name, dependencies, created_at, updated_at
      FROM tasks
      ORDER BY created_at DESC
    `)
    const rows = stmt.all() as Array<{
      id: number
      title: string
      description: string
      assignee: string | null
      column_name: string
      dependencies: string
      created_at: string
      updated_at: string
    }>
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      assignee: row.assignee,
      column: row.column_name,
      dependencies: JSON.parse(row.dependencies),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }))
  }

  async getTaskById(id: number): Promise<TaskRow | null> {
    const stmt = this.db.prepare(`
      SELECT id, title, description, assignee, column_name, dependencies, created_at, updated_at
      FROM tasks WHERE id = ?
    `)
    const row = stmt.get(id) as any
    if (!row) return null
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      assignee: row.assignee,
      column: row.column_name,
      dependencies: JSON.parse(row.dependencies),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }
  }

  async createTask(
    title: string,
    description: string,
    assignee: string | null,
    column: string,
    dependencies: number[]
  ): Promise<TaskRow> {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO tasks (title, description, assignee, column_name, dependencies, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id, title, description, assignee, column_name, dependencies, created_at, updated_at
    `)
    const row = stmt.get(title, description, assignee, column, JSON.stringify(dependencies), now, now) as any
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      assignee: row.assignee,
      column: row.column_name,
      dependencies: JSON.parse(row.dependencies),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }
  }

  async updateTask(
    id: number,
    updates: Partial<Pick<TaskRow, 'title' | 'description' | 'assignee' | 'column' | 'dependencies'>>
  ): Promise<TaskRow | null> {
    const setParts: string[] = []
    const values: any[] = []
    if (updates.title !== undefined) {
      setParts.push('title = ?')
      values.push(updates.title)
    }
    if (updates.description !== undefined) {
      setParts.push('description = ?')
      values.push(updates.description)
    }
    if (updates.assignee !== undefined) {
      setParts.push('assignee = ?')
      values.push(updates.assignee)
    }
    if (updates.column !== undefined) {
      setParts.push('column_name = ?')
      values.push(updates.column)
    }
    if (updates.dependencies !== undefined) {
      setParts.push('dependencies = ?')
      values.push(JSON.stringify(updates.dependencies))
    }
    if (setParts.length === 0) return this.getTaskById(id)
    setParts.push('updated_at = ?')
    values.push(new Date().toISOString())
    const sql = `UPDATE tasks SET ${setParts.join(', ')} WHERE id = ? RETURNING id, title, description, assignee, column_name, dependencies, created_at, updated_at`
    values.push(id)
    const stmt = this.db.prepare(sql)
    const row = stmt.get(...values) as any
    if (!row) return null
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      assignee: row.assignee,
      column: row.column_name,
      dependencies: JSON.parse(row.dependencies),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }
  }

  async deleteTask(id: number): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM tasks WHERE id = ?`)
    stmt.run(id)
  }

  async searchTasks(query: string, filters?: { assignee?: string; column?: string }): Promise<TaskRow[]> {
    let sql = `
      SELECT id, title, description, assignee, column_name, dependencies, created_at, updated_at
      FROM tasks
      WHERE (title LIKE ? OR description LIKE ?)
    `
    const params: any[] = [`${query}%`, `${query}%`]

    if (filters?.assignee) {
      sql += ` AND assignee = ?`
      params.push(filters.assignee)
    }
    if (filters?.column) {
      sql += ` AND column_name = ?`
      params.push(filters.column)
    }

    sql += ` ORDER BY created_at DESC`

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as Array<{
      id: number
      title: string
      description: string
      assignee: string | null
      column_name: string
      dependencies: string
      created_at: string
      updated_at: string
    }>
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      assignee: row.assignee,
      column: row.column_name,
      dependencies: JSON.parse(row.dependencies),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }))
  }

  async listTaskHistory(taskId: number): Promise<TaskHistoryRow[]> {
    const stmt = this.db.prepare(`
      SELECT id, task_id, from_column, to_column, moved_at
      FROM task_history
      WHERE task_id = ?
      ORDER BY moved_at ASC
    `)
    const rows = stmt.all(taskId) as Array<{
      id: number
      task_id: number
      from_column: string | null
      to_column: string
      moved_at: string
    }>
    return rows.map(row => ({
      id: row.id,
      task_id: row.task_id,
      from_column: row.from_column,
      to_column: row.to_column,
      moved_at: new Date(row.moved_at),
    }))
  }

  async createTaskHistory(taskId: number, fromColumn: string | null, toColumn: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO task_history (task_id, from_column, to_column, moved_at)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(taskId, fromColumn, toColumn, new Date().toISOString())
  }

  // Migrations
  async runMigrations(): Promise<void> {
    const MIGRATIONS = [
      {
        version: 1,
        name: 'create_sessions',
        sql: `
          CREATE TABLE IF NOT EXISTS sessions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT UNIQUE NOT NULL,
            session_id TEXT UNIQUE NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name);
        `,
      },
      {
        version: 2,
        name: 'add_agent_code',
        sql: `
          ALTER TABLE sessions ADD COLUMN agent_code TEXT NOT NULL DEFAULT '';
          CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_agent_code ON sessions(agent_code);
          -- Update existing rows with new UUIDs
          UPDATE sessions SET agent_code = lower(hex(randomblob(16)));
        `,
      },
      {
        version: 3,
        name: 'create_config_table',
        sql: `
          CREATE TABLE IF NOT EXISTS config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );
          INSERT OR IGNORE INTO config (key, value) VALUES ('human_name', 'Human');
          INSERT OR IGNORE INTO config (key, value) VALUES ('human_description', '');
        `,
      },
      {
        version: 4,
        name: 'create_messages_table',
        sql: `
          CREATE TABLE IF NOT EXISTS messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            from_name   TEXT NOT NULL,
            to_name     TEXT NOT NULL,
            body        TEXT NOT NULL,
            read        INTEGER NOT NULL DEFAULT 0,
            injected    INTEGER NOT NULL DEFAULT 0,
            created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_messages_to_name ON messages(to_name);
          CREATE INDEX IF NOT EXISTS idx_messages_from_name ON messages(from_name);
          CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(read);
        `,
      },
      {
        version: 5,
        name: 'add_mode_to_sessions',
        sql: `
          ALTER TABLE sessions ADD COLUMN mode TEXT NULL;
        `,
      },
      {
        version: 6,
        name: 'create_cron_tables',
        sql: `
          CREATE TABLE IF NOT EXISTS cron_jobs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            session_name  TEXT NOT NULL REFERENCES sessions(name) ON DELETE CASCADE,
            schedule      TEXT NOT NULL,
            timezone      TEXT,
            message       TEXT NOT NULL,
            enabled       INTEGER NOT NULL DEFAULT 1,
            created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_run      DATETIME
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_jobs_name_session ON cron_jobs(name, session_name);
          CREATE INDEX IF NOT EXISTS idx_cron_jobs_session_name ON cron_jobs(session_name);
          CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);

          CREATE TABLE IF NOT EXISTS cron_history (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            cron_job_id    INTEGER NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
            executed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            success        INTEGER NOT NULL DEFAULT 1,
            error_message  TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_cron_history_job_id ON cron_history(cron_job_id);
        `,
      },
      {
        version: 7,
        name: 'add_status_to_sessions',
        sql: `
          ALTER TABLE sessions ADD COLUMN status TEXT NULL;
        `,
      },
      {
        version: 8,
        name: 'rename_mode_to_agent',
        sql: `
          -- SQLite doesn't support RENAME COLUMN directly in older versions
          -- Create new table with correct schema
          CREATE TABLE sessions_new (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT UNIQUE NOT NULL,
            session_id TEXT UNIQUE NOT NULL,
            agent_code TEXT NOT NULL,
            agent      TEXT NULL,
            status     TEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO sessions_new (id, name, session_id, agent_code, agent, status, created_at)
          SELECT id, name, session_id, agent_code, mode, status, created_at FROM sessions;
          DROP TABLE sessions;
          ALTER TABLE sessions_new RENAME TO sessions;
          CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_agent_code ON sessions(agent_code);
        `,
      },
      {
        version: 9,
        name: 'add_notified_to_messages',
        sql: `
          ALTER TABLE messages ADD COLUMN notified INTEGER NOT NULL DEFAULT 0;
        `,
      },
      {
        version: 10,
        name: 'create_tasks_table',
        sql: `
          CREATE TABLE IF NOT EXISTS tasks (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            title        TEXT NOT NULL,
            description  TEXT NOT NULL,
            assignee     TEXT,
            column_name  TEXT NOT NULL,
            dependencies TEXT NOT NULL DEFAULT '[]',
            created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
          CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_name);
        `,
      },
      {
        version: 11,
        name: 'create_cron_requests_table',
        sql: `
          CREATE TABLE IF NOT EXISTS cron_requests (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            session_name    TEXT NOT NULL REFERENCES sessions(name) ON DELETE CASCADE,
            schedule        TEXT NOT NULL,
            timezone        TEXT,
            message         TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending',
            requested_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reviewed_at     DATETIME,
            reviewed_by     TEXT,
            reviewer_notes  TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_cron_requests_session_name ON cron_requests(session_name);
          CREATE INDEX IF NOT EXISTS idx_cron_requests_status ON cron_requests(status);
        `,
      },
      {
        version: 12,
        name: 'add_description_and_philosophy_to_sessions',
        sql: `
          ALTER TABLE sessions ADD COLUMN description TEXT;
          ALTER TABLE sessions ADD COLUMN philosophy TEXT;
          ALTER TABLE sessions ADD COLUMN visual_description TEXT;
        `,
      },
      {
        version: 13,
        name: 'create_task_history_table',
        sql: `
          CREATE TABLE IF NOT EXISTS task_history (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            from_column  TEXT,
            to_column    TEXT NOT NULL,
            moved_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_task_history_task_id ON task_history(task_id);
        `,
      },
      {
        version: 14,
        name: 'simplify_sessions_table',
        sql: `
          -- Create new simplified sessions table
          CREATE TABLE sessions_new (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT UNIQUE NOT NULL,
            coworkerType     TEXT,
            status           TEXT,
            description      TEXT,
            philosophy       TEXT,
            visual_description TEXT,
            created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          
          -- Copy data from old table
          INSERT INTO sessions_new (id, name, coworkerType, status, description, philosophy, visual_description, created_at)
          SELECT id, name, agent, status, description, philosophy, visual_description, created_at FROM sessions;
          
          -- Drop old table
          DROP TABLE sessions;
          
          -- Rename new table
          ALTER TABLE sessions_new RENAME TO sessions;
          
          -- Recreate index
          CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name);
        `,
      },
    ]

    // Create migrations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const appliedStmt = this.db.prepare(`SELECT version FROM _migrations ORDER BY version`)
    const applied = appliedStmt.all() as { version: number }[]
    const appliedVersions = new Set(applied.map(r => r.version))

    for (const migration of MIGRATIONS) {
      if (appliedVersions.has(migration.version)) continue

      console.log(`  Applying migration ${migration.version}: ${migration.name}`)

      // Run migration in a transaction
      const migrate = this.db.transaction(() => {
        this.db.exec(migration.sql)
        const insertStmt = this.db.prepare(`
          INSERT INTO _migrations (version, name) VALUES (?, ?)
        `)
        insertStmt.run(migration.version, migration.name)
      })
      migrate()
    }
  }
}

export function createSqliteStorage(databasePath: string): AgentOfficeSqliteStorage {
  const db = new Database(databasePath)
  // Enable foreign keys
  db.exec('PRAGMA foreign_keys = ON')
  return new AgentOfficeSqliteStorage(db)
}
