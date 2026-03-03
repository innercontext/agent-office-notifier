import postgres from 'postgres'
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

export class AgentOfficePostgresqlStorage extends AgentOfficeStorageBase {
  constructor(private sql: ReturnType<typeof postgres>) {
    super()
  }

  async close(): Promise<void> {
    await this.sql.end()
  }

  async begin<T>(callback: (tx: import('./storage.js').AgentOfficeStorage) => Promise<T>): Promise<T> {
    return this.sql.begin(async tx => {
      const txStorage = new AgentOfficePostgresqlStorage(tx as unknown as ReturnType<typeof postgres>)
      return callback(txStorage)
    }) as Promise<T>
  }

  // Sessions
  async listSessions(): Promise<SessionRow[]> {
    return this.sql<SessionRow[]>`
      SELECT id, name, coworkerType, status, description, philosophy, visual_description, created_at
      FROM sessions
      ORDER BY created_at DESC
    `
  }

  async getSessionByName(name: string): Promise<SessionRow | null> {
    const [row] = await this.sql<SessionRow[]>`
      SELECT id, name, coworkerType, status, description, philosophy, visual_description, created_at
      FROM sessions WHERE name = ${name}
    `
    return row ?? null
  }

  async getSessionIdByName(name: string): Promise<number | null> {
    const [row] = await this.sql<{ id: number }[]>`
      SELECT id FROM sessions WHERE name = ${name}
    `
    return row?.id ?? null
  }

  async createSession(name: string, coworkerType: string): Promise<SessionRow> {
    const [row] = await this.sql<SessionRow[]>`
      INSERT INTO sessions (name, coworkerType)
      VALUES (${name}, ${coworkerType})
      RETURNING id, name, coworkerType, status, description, philosophy, visual_description, created_at
    `
    return row!
  }

  async deleteSession(id: number): Promise<void> {
    await this.sql`DELETE FROM sessions WHERE id = ${id}`
  }

  async updateSession(
    name: string,
    updates: Partial<Pick<SessionRow, 'coworkerType' | 'status' | 'description' | 'philosophy' | 'visual_description'>>
  ): Promise<SessionRow | null> {
    // Build dynamic update using unsafe for conditional fields
    const setParts: string[] = []
    const values: any[] = []

    if (updates.coworkerType !== undefined) {
      setParts.push('coworkerType = ')
      values.push(updates.coworkerType)
    }
    if (updates.status !== undefined) {
      setParts.push('status = ')
      values.push(updates.status)
    }
    if (updates.description !== undefined) {
      setParts.push('description = ')
      values.push(updates.description)
    }
    if (updates.philosophy !== undefined) {
      setParts.push('philosophy = ')
      values.push(updates.philosophy)
    }
    if (updates.visual_description !== undefined) {
      setParts.push('visual_description = ')
      values.push(updates.visual_description)
    }

    if (setParts.length === 0) {
      return this.getSessionByName(name)
    }

    // Build the SET clause
    const setClause = setParts.map((part, i) => `${part}$${i + 1}`).join(', ')
    const sql = `
      UPDATE sessions
      SET ${setClause}
      WHERE name = $${values.length + 1}
      RETURNING id, name, coworkerType, status, description, philosophy, visual_description, created_at
    `
    values.push(name)

    const [row] = await this.sql.unsafe(sql, values)
    return (row as unknown as SessionRow) ?? null
  }

  async sessionExists(name: string): Promise<boolean> {
    const [row] = await this.sql<{ id: number }[]>`
      SELECT id FROM sessions WHERE name = ${name}
    `
    return !!row
  }

  // Config
  async getAllConfig(): Promise<ConfigRow[]> {
    return this.sql<ConfigRow[]>`SELECT key, value FROM config`
  }

  async getConfig(key: string): Promise<string | null> {
    const [row] = await this.sql<ConfigRow[]>`
      SELECT value FROM config WHERE key = ${key}
    `
    return row?.value ?? null
  }

  async setConfig(key: string, value: string): Promise<void> {
    await this.sql`
      INSERT INTO config (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `
  }

  // Messages
  async listMessagesForRecipient(
    name: string,
    filters?: { unread?: boolean; olderThanHours?: number; notified?: boolean }
  ): Promise<MessageRow[]> {
    const whereClauses: string[] = ['to_name = $1']
    const params: unknown[] = [name]

    if (filters?.unread) whereClauses.push('read = FALSE')
    if (filters?.notified === false) whereClauses.push('notified = FALSE')
    if (filters?.olderThanHours !== undefined) {
      whereClauses.push(`created_at < NOW() - INTERVAL '${filters.olderThanHours} hours'`)
    }

    const whereSQL = whereClauses.join(' AND ')
    const rows = await this.sql.unsafe<MessageRow[]>(
      `SELECT id, from_name, to_name, body, read, injected, created_at, notified FROM messages WHERE ${whereSQL} ORDER BY created_at DESC`,
      params as string[]
    )
    return rows
  }

  async listMessagesFromSender(name: string): Promise<MessageRow[]> {
    return this.sql<MessageRow[]>`
      SELECT id, from_name, to_name, body, read, injected, created_at
      FROM messages
      WHERE from_name = ${name}
      ORDER BY created_at DESC
    `
  }

  async listMessagesBetween(
    coworker1: string,
    coworker2: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<MessageRow[]> {
    let conditions: string[] = []
    const params: any[] = [coworker1, coworker2, coworker2, coworker1]
    let paramIndex = 5

    // Base condition for bidirectional messaging
    conditions.push(`((from_name = $1 AND to_name = $2) OR (from_name = $3 AND to_name = $4))`)

    if (startTime) {
      conditions.push(`created_at >= $${paramIndex++}`)
      params.push(startTime)
    }
    if (endTime) {
      conditions.push(`created_at <= $${paramIndex++}`)
      params.push(endTime)
    }

    const sql = `
      SELECT id, from_name, to_name, body, read, injected, created_at
      FROM messages
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at ASC
    `

    return this.sql.unsafe(sql, params) as Promise<MessageRow[]>
  }

  async countUnreadBySender(recipientName: string): Promise<Map<string, number>> {
    const rows = await this.sql<Array<{ from_name: string; count: bigint }>>`
      SELECT from_name, COUNT(*) as count
      FROM messages
      WHERE to_name = ${recipientName} AND read = FALSE
      GROUP BY from_name
    `
    const result = new Map<string, number>()
    for (const row of rows) {
      result.set(row.from_name, Number(row.count))
    }
    return result
  }

  async lastMessageAtByCoworker(humanName: string): Promise<Map<string, Date>> {
    const rows = await this.sql<Array<{ coworker: string; last_at: Date }>>`
      SELECT
        CASE WHEN from_name = ${humanName} THEN to_name ELSE from_name END AS coworker,
        MAX(created_at) AS last_at
      FROM messages
      WHERE from_name = ${humanName} OR to_name = ${humanName}
      GROUP BY coworker
    `
    const result = new Map<string, Date>()
    for (const row of rows) {
      result.set(row.coworker, row.last_at)
    }
    return result
  }

  async createMessageImpl(from: string, to: string, body: string): Promise<MessageRow> {
    const [row] = await this.sql<MessageRow[]>`
      INSERT INTO messages (from_name, to_name, body)
      VALUES (${from}, ${to}, ${body})
      RETURNING id, from_name, to_name, body, read, injected, created_at
    `
    return row!
  }

  async markMessageAsRead(id: number): Promise<MessageRow | null> {
    const [row] = await this.sql<MessageRow[]>`
      UPDATE messages SET read = TRUE WHERE id = ${id}
      RETURNING id, from_name, to_name, body, read, injected, created_at
    `
    return row ?? null
  }

  async markMessageAsInjected(id: number): Promise<void> {
    await this.sql`UPDATE messages SET injected = TRUE WHERE id = ${id}`
  }

  async markMessagesAsNotified(ids: number[]): Promise<void> {
    if (ids.length === 0) return
    await this.sql`UPDATE messages SET notified = TRUE WHERE id = ANY(${ids})`
  }

  async deleteMessagesForCoworker(name: string): Promise<void> {
    await this.sql`DELETE FROM messages WHERE from_name = ${name} OR to_name = ${name}`
  }

  // Cron Jobs
  async listCronJobs(): Promise<CronJobRow[]> {
    return this.sql<CronJobRow[]>`
      SELECT id, name, session_name, schedule, timezone, message, enabled, created_at, last_run
      FROM cron_jobs
      ORDER BY name
    `
  }

  async listCronJobsForSession(sessionName: string): Promise<CronJobRow[]> {
    return this.sql<CronJobRow[]>`
      SELECT id, name, session_name, schedule, timezone, message, enabled, created_at, last_run
      FROM cron_jobs
      WHERE session_name = ${sessionName}
      ORDER BY name
    `
  }

  async getCronJobById(id: number): Promise<CronJobRow | null> {
    const [row] = await this.sql<CronJobRow[]>`
      SELECT id, name, session_name, schedule, timezone, message, enabled, created_at, last_run
      FROM cron_jobs WHERE id = ${id}
    `
    return row ?? null
  }

  async getCronJobByNameAndSession(name: string, sessionName: string): Promise<CronJobRow | null> {
    const [row] = await this.sql<CronJobRow[]>`
      SELECT id, name, session_name, schedule, timezone, message, enabled, created_at, last_run
      FROM cron_jobs WHERE name = ${name} AND session_name = ${sessionName}
    `
    return row ?? null
  }

  async createCronJob(
    name: string,
    sessionName: string,
    schedule: string,
    timezone: string,
    message: string
  ): Promise<CronJobRow> {
    const [row] = await this.sql<CronJobRow[]>`
      INSERT INTO cron_jobs (name, session_name, schedule, timezone, message)
      VALUES (${name}, ${sessionName}, ${schedule}, ${timezone}, ${message})
      RETURNING id, name, session_name, schedule, timezone, message, enabled, created_at, last_run
    `
    return row!
  }

  async deleteCronJob(id: number): Promise<void> {
    await this.sql`DELETE FROM cron_jobs WHERE id = ${id}`
  }

  async enableCronJob(id: number): Promise<void> {
    await this.sql`UPDATE cron_jobs SET enabled = TRUE WHERE id = ${id}`
  }

  async disableCronJob(id: number): Promise<void> {
    await this.sql`UPDATE cron_jobs SET enabled = FALSE WHERE id = ${id}`
  }

  async updateCronJobLastRun(id: number, lastRun: Date): Promise<void> {
    await this.sql`UPDATE cron_jobs SET last_run = ${lastRun} WHERE id = ${id}`
  }

  async cronJobExistsForSession(name: string, sessionName: string): Promise<boolean> {
    const [row] = await this.sql<{ id: number }[]>`
      SELECT id FROM cron_jobs WHERE name = ${name} AND session_name = ${sessionName}
    `
    return !!row
  }

  // Cron History
  async listCronHistory(cronJobId: number, limit: number): Promise<CronHistoryRow[]> {
    return this.sql<CronHistoryRow[]>`
      SELECT id, cron_job_id, executed_at, success, error_message
      FROM cron_history
      WHERE cron_job_id = ${cronJobId}
      ORDER BY executed_at DESC
      LIMIT ${limit}
    `
  }

  async createCronHistory(cronJobId: number, executedAt: Date, success: boolean, errorMessage?: string): Promise<void> {
    if (success) {
      await this.sql`
        INSERT INTO cron_history (cron_job_id, executed_at, success)
        VALUES (${cronJobId}, ${executedAt}, TRUE)
      `
    } else {
      await this.sql`
        INSERT INTO cron_history (cron_job_id, executed_at, success, error_message)
        VALUES (${cronJobId}, ${executedAt}, FALSE, ${errorMessage ?? null})
      `
    }
  }

  // Cron Requests
  async listCronRequests(filters?: { status?: string; sessionName?: string }): Promise<CronRequestRow[]> {
    if (filters?.status && filters?.sessionName) {
      return this.sql<CronRequestRow[]>`
        SELECT id, name, session_name, schedule, timezone, message, status, requested_at, reviewed_at, reviewed_by, reviewer_notes
        FROM cron_requests
        WHERE status = ${filters.status} AND session_name = ${filters.sessionName}
        ORDER BY requested_at DESC
      `
    } else if (filters?.status) {
      return this.sql<CronRequestRow[]>`
        SELECT id, name, session_name, schedule, timezone, message, status, requested_at, reviewed_at, reviewed_by, reviewer_notes
        FROM cron_requests
        WHERE status = ${filters.status}
        ORDER BY requested_at DESC
      `
    } else if (filters?.sessionName) {
      return this.sql<CronRequestRow[]>`
        SELECT id, name, session_name, schedule, timezone, message, status, requested_at, reviewed_at, reviewed_by, reviewer_notes
        FROM cron_requests
        WHERE session_name = ${filters.sessionName}
        ORDER BY requested_at DESC
      `
    } else {
      return this.sql<CronRequestRow[]>`
        SELECT id, name, session_name, schedule, timezone, message, status, requested_at, reviewed_at, reviewed_by, reviewer_notes
        FROM cron_requests
        ORDER BY requested_at DESC
      `
    }
  }

  async getCronRequestById(id: number): Promise<CronRequestRow | null> {
    const [row] = await this.sql<CronRequestRow[]>`
      SELECT id, name, session_name, schedule, timezone, message, status, requested_at, reviewed_at, reviewed_by, reviewer_notes
      FROM cron_requests WHERE id = ${id}
    `
    return row ?? null
  }

  async createCronRequest(
    name: string,
    sessionName: string,
    schedule: string,
    timezone: string,
    message: string
  ): Promise<CronRequestRow> {
    const [row] = await this.sql<CronRequestRow[]>`
      INSERT INTO cron_requests (name, session_name, schedule, timezone, message)
      VALUES (${name}, ${sessionName}, ${schedule}, ${timezone}, ${message})
      RETURNING id, name, session_name, schedule, timezone, message, status, requested_at, reviewed_at, reviewed_by, reviewer_notes
    `
    return row!
  }

  async updateCronRequestStatus(
    id: number,
    status: 'approved' | 'rejected',
    reviewedBy: string,
    reviewerNotes?: string
  ): Promise<CronRequestRow | null> {
    const [row] = await this.sql<CronRequestRow[]>`
      UPDATE cron_requests
      SET status = ${status}, reviewed_at = NOW(), reviewed_by = ${reviewedBy}, reviewer_notes = ${reviewerNotes ?? null}
      WHERE id = ${id}
      RETURNING id, name, session_name, schedule, timezone, message, status, requested_at, reviewed_at, reviewed_by, reviewer_notes
    `
    return row ?? null
  }

  async deleteCronRequest(id: number): Promise<void> {
    await this.sql`DELETE FROM cron_requests WHERE id = ${id}`
  }

  // Tasks
  async listTasks(): Promise<TaskRow[]> {
    return this.sql<TaskRow[]>`
      SELECT id, title, description, assignee, column_name as column, dependencies, created_at, updated_at
      FROM tasks
      ORDER BY created_at DESC
    `
  }

  async getTaskById(id: number): Promise<TaskRow | null> {
    const [row] = await this.sql<TaskRow[]>`
      SELECT id, title, description, assignee, column_name as column, dependencies, created_at, updated_at
      FROM tasks WHERE id = ${id}
    `
    return row ?? null
  }

  async createTask(
    title: string,
    description: string,
    assignee: string | null,
    column: string,
    dependencies: number[]
  ): Promise<TaskRow> {
    const [row] = await this.sql<TaskRow[]>`
      INSERT INTO tasks (title, description, assignee, column_name, dependencies)
      VALUES (${title}, ${description}, ${assignee}, ${column}, ${JSON.stringify(dependencies)}::jsonb)
      RETURNING id, title, description, assignee, column_name as column, dependencies, created_at, updated_at
    `
    return row!
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
    setParts.push('updated_at = NOW()')
    const sql = `UPDATE tasks SET ${setParts.join(', ')} WHERE id = ? RETURNING id, title, description, assignee, column_name as column, dependencies, created_at, updated_at`
    values.push(id)
    const [row] = (await this.sql.unsafe(sql, values)) as TaskRow[]
    return row ?? null
  }

  async deleteTask(id: number): Promise<void> {
    await this.sql`DELETE FROM tasks WHERE id = ${id}`
  }

  async searchTasks(query: string, filters?: { assignee?: string; column?: string }): Promise<TaskRow[]> {
    const conditions: string[] = []
    const params: any[] = []

    conditions.push(`(title ILIKE $${params.length + 1} OR description ILIKE $${params.length + 1})`)
    params.push(`${query}%`)

    if (filters?.assignee) {
      conditions.push(`assignee = $${params.length + 1}`)
      params.push(filters.assignee)
    }
    if (filters?.column) {
      conditions.push(`column_name = $${params.length + 1}`)
      params.push(filters.column)
    }

    const sql = `
      SELECT id, title, description, assignee, column_name as column, dependencies, created_at, updated_at
      FROM tasks
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
    `

    return this.sql.unsafe(sql, params)
  }

  async listTaskHistory(taskId: number): Promise<TaskHistoryRow[]> {
    return this.sql`
      SELECT id, task_id, from_column, to_column, moved_at
      FROM task_history
      WHERE task_id = ${taskId}
      ORDER BY moved_at ASC
    `
  }

  async createTaskHistory(taskId: number, fromColumn: string | null, toColumn: string): Promise<void> {
    await this.sql`
      INSERT INTO task_history (task_id, from_column, to_column, moved_at)
      VALUES (${taskId}, ${fromColumn}, ${toColumn}, NOW())
    `
  }

  async runMigrations(): Promise<void> {
    const MIGRATIONS = [
      {
        version: 1,
        name: 'create_sessions',
        sql: `
          CREATE TABLE IF NOT EXISTS sessions (
            id         SERIAL PRIMARY KEY,
            name       VARCHAR(255) UNIQUE NOT NULL,
            session_id VARCHAR(255) UNIQUE NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name);
        `,
      },
      {
        version: 2,
        name: 'add_agent_code',
        sql: `
          ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agent_code UUID NOT NULL DEFAULT gen_random_uuid();
          CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_agent_code ON sessions(agent_code);
        `,
      },
      {
        version: 3,
        name: 'create_config_table',
        sql: `
          CREATE TABLE IF NOT EXISTS config (
            key   VARCHAR(255) PRIMARY KEY,
            value TEXT NOT NULL
          );
          INSERT INTO config (key, value) VALUES ('human_name', 'Human') ON CONFLICT DO NOTHING;
          INSERT INTO config (key, value) VALUES ('human_description', '') ON CONFLICT DO NOTHING;
        `,
      },
      {
        version: 5,
        name: 'add_mode_to_sessions',
        sql: `
          ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mode VARCHAR(255) NULL;
        `,
      },
      {
        version: 4,
        name: 'create_messages_table',
        sql: `
          CREATE TABLE IF NOT EXISTS messages (
            id          SERIAL PRIMARY KEY,
            from_name   VARCHAR(255) NOT NULL,
            to_name     VARCHAR(255) NOT NULL,
            body        TEXT NOT NULL,
            read        BOOLEAN NOT NULL DEFAULT FALSE,
            injected    BOOLEAN NOT NULL DEFAULT FALSE,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_messages_to_name ON messages(to_name);
          CREATE INDEX IF NOT EXISTS idx_messages_from_name ON messages(from_name);
          CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(read);
        `,
      },
      {
        version: 6,
        name: 'create_cron_tables',
        sql: `
          CREATE TABLE IF NOT EXISTS cron_jobs (
            id            SERIAL PRIMARY KEY,
            name          VARCHAR(255) NOT NULL,
            session_name  VARCHAR(255) NOT NULL REFERENCES sessions(name) ON DELETE CASCADE,
            schedule      TEXT NOT NULL,
            timezone      VARCHAR(100),
            message       TEXT NOT NULL,
            enabled       BOOLEAN NOT NULL DEFAULT TRUE,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_run      TIMESTAMPTZ
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_jobs_name_session ON cron_jobs(name, session_name);
          CREATE INDEX IF NOT EXISTS idx_cron_jobs_session_name ON cron_jobs(session_name);
          CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);

          CREATE TABLE IF NOT EXISTS cron_history (
            id             SERIAL PRIMARY KEY,
            cron_job_id    INTEGER NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
            executed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            success        BOOLEAN NOT NULL DEFAULT TRUE,
            error_message  TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_cron_history_job_id ON cron_history(cron_job_id);
        `,
      },
      {
        version: 7,
        name: 'add_status_to_sessions',
        sql: `
          ALTER TABLE sessions ADD COLUMN IF NOT EXISTS status TEXT NULL;
        `,
      },
      {
        version: 8,
        name: 'rename_mode_to_agent',
        sql: `
          ALTER TABLE sessions RENAME COLUMN mode TO agent;
        `,
      },
      {
        version: 9,
        name: 'add_notified_to_messages',
        sql: `
          ALTER TABLE messages ADD COLUMN IF NOT EXISTS notified BOOLEAN NOT NULL DEFAULT FALSE;
        `,
      },
      {
        version: 10,
        name: 'create_tasks_table',
        sql: `
          CREATE TABLE IF NOT EXISTS tasks (
            id           SERIAL PRIMARY KEY,
            title        TEXT NOT NULL,
            description  TEXT NOT NULL,
            assignee     TEXT,
            column_name  TEXT NOT NULL,
            dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
            id              SERIAL PRIMARY KEY,
            name            VARCHAR(255) NOT NULL,
            session_name    VARCHAR(255) NOT NULL REFERENCES sessions(name) ON DELETE CASCADE,
            schedule        TEXT NOT NULL,
            timezone        VARCHAR(100),
            message         TEXT NOT NULL,
            status          VARCHAR(20) NOT NULL DEFAULT 'pending',
            requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reviewed_at     TIMESTAMPTZ,
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
          ALTER TABLE sessions ADD COLUMN IF NOT EXISTS description TEXT;
          ALTER TABLE sessions ADD COLUMN IF NOT EXISTS philosophy TEXT;
          ALTER TABLE sessions ADD COLUMN IF NOT EXISTS visual_description TEXT;
        `,
      },
      {
        version: 13,
        name: 'create_task_history_table',
        sql: `
          CREATE TABLE IF NOT EXISTS task_history (
            id           SERIAL PRIMARY KEY,
            task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            from_column  TEXT,
            to_column    TEXT NOT NULL,
            moved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_task_history_task_id ON task_history(task_id);
        `,
      },
      {
        version: 14,
        name: 'simplify_sessions_table',
        sql: `
          -- Drop unused columns
          ALTER TABLE sessions DROP COLUMN IF EXISTS session_id;
          ALTER TABLE sessions DROP COLUMN IF EXISTS agent_code;
          
          -- Rename agent to coworkerType
          ALTER TABLE sessions RENAME COLUMN agent TO coworkerType;
        `,
      },
    ]

    await this.sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        version    INTEGER PRIMARY KEY,
        name       VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

    const applied = await this.sql<{ version: number }[]>`
      SELECT version FROM _migrations ORDER BY version
    `
    const appliedVersions = new Set(applied.map(r => r.version))

    for (const migration of MIGRATIONS) {
      if (appliedVersions.has(migration.version)) continue

      console.log(`  Applying migration ${migration.version}: ${migration.name}`)
      await this.sql.begin(async tx => {
        await tx.unsafe(migration.sql)
        await tx.unsafe(`INSERT INTO _migrations (version, name) VALUES ($1, $2)`, [migration.version, migration.name])
      })
    }
  }
}

export function createPostgresqlStorage(databaseUrl: string): AgentOfficePostgresqlStorage {
  const sql = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  })
  return new AgentOfficePostgresqlStorage(sql)
}
