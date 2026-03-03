import {
  AgentOfficeStorage,
  WatchListener,
  WatchState,
  SenderInfo,
  SessionRow,
  ConfigRow,
  MessageRow,
  CronJobRow,
  CronHistoryRow,
  CronRequestRow,
  TaskRow,
  TaskHistoryRow,
} from './storage.js'

export type { WatchListener, WatchState, SenderInfo }

export class MockAgentOfficeStorage implements AgentOfficeStorage {
  private sessions: SessionRow[] = []
  private sessionIdCounter = 1
  private configs: ConfigRow[] = []
  private messages: MessageRow[] = []
  private messageIdCounter = 1
  private cronJobs: CronJobRow[] = []
  private cronJobIdCounter = 1
  private cronHistory: CronHistoryRow[] = []
  private cronHistoryIdCounter = 1
  private cronRequests: CronRequestRow[] = []
  private cronRequestIdCounter = 1
  private tasks: TaskRow[] = []
  private taskIdCounter = 1
  private taskHistory: TaskHistoryRow[] = []
  private taskHistoryIdCounter = 1
  private listeners: Set<WatchListener> = new Set()
  private closed = false

  // Connection/Transaction
  async close(): Promise<void> {
    this.closed = true
  }

  isClosed(): boolean {
    return this.closed
  }

  async begin<T>(callback: (tx: AgentOfficeStorage) => Promise<T>): Promise<T> {
    return callback(this)
  }

  // Watch
  watch(listener: WatchListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyWatchers(): void {
    const state: WatchState = {}
    for (const message of this.messages) {
      if (!state[message.to_name]) {
        state[message.to_name] = {}
      }
      state[message.to_name][message.from_name] = {
        lastSent: message.created_at.toISOString(),
      }
    }
    for (const listener of this.listeners) {
      listener(state)
    }
  }

  // Sessions
  async listSessions(): Promise<SessionRow[]> {
    return [...this.sessions].sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
  }

  async getSessionByName(name: string): Promise<SessionRow | null> {
    return this.sessions.find(s => s.name === name) ?? null
  }

  async getSessionIdByName(name: string): Promise<number | null> {
    const session = this.sessions.find(s => s.name === name)
    return session?.id ?? null
  }

  async createSession(name: string, coworkerType: string): Promise<SessionRow> {
    const newSession: SessionRow = {
      id: this.sessionIdCounter++,
      name,
      coworkerType,
      status: null,
      description: null,
      philosophy: null,
      visual_description: null,
      created_at: new Date(),
    }
    this.sessions.push(newSession)
    return newSession
  }

  async deleteSession(id: number): Promise<void> {
    const index = this.sessions.findIndex(s => s.id === id)
    if (index !== -1) {
      this.sessions.splice(index, 1)
    }
  }

  async updateSession(
    name: string,
    updates: Partial<Pick<SessionRow, 'coworkerType' | 'status' | 'description' | 'philosophy' | 'visual_description'>>
  ): Promise<SessionRow | null> {
    const session = this.sessions.find(s => s.name === name)
    if (!session) {
      return null
    }
    if (updates.coworkerType !== undefined) session.coworkerType = updates.coworkerType
    if (updates.status !== undefined) session.status = updates.status
    if (updates.description !== undefined) session.description = updates.description
    if (updates.philosophy !== undefined) session.philosophy = updates.philosophy
    if (updates.visual_description !== undefined) session.visual_description = updates.visual_description
    return session
  }

  async sessionExists(name: string): Promise<boolean> {
    return this.sessions.some(s => s.name === name)
  }

  // Config
  async getAllConfig(): Promise<ConfigRow[]> {
    return [...this.configs]
  }

  async getConfig(key: string): Promise<string | null> {
    const config = this.configs.find(c => c.key === key)
    return config?.value ?? null
  }

  async setConfig(key: string, value: string): Promise<void> {
    const index = this.configs.findIndex(c => c.key === key)
    if (index !== -1) {
      this.configs[index].value = value
    } else {
      this.configs.push({ key, value })
    }
  }

  // Messages
  async listMessagesForRecipient(
    name: string,
    filters?: { unread?: boolean; olderThanHours?: number; notified?: boolean }
  ): Promise<MessageRow[]> {
    let messages = this.messages.filter(m => m.to_name === name)

    if (filters?.unread) {
      messages = messages.filter(m => !m.read)
    }
    if (filters?.notified === false) {
      messages = messages.filter(m => !m.notified)
    }
    if (filters?.olderThanHours !== undefined) {
      const cutoff = new Date(Date.now() - filters.olderThanHours * 60 * 60 * 1000)
      messages = messages.filter(m => m.created_at < cutoff)
    }

    return messages.sort((a, b) => b.created_at.getTime() - a.created_at.getTime()).map(m => ({ ...m }))
  }

  async listMessagesFromSender(name: string): Promise<MessageRow[]> {
    return this.messages
      .filter(m => m.from_name === name)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .map(m => ({ ...m }))
  }

  async listMessagesBetween(
    coworker1: string,
    coworker2: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<MessageRow[]> {
    let filtered = this.messages.filter(
      m =>
        (m.from_name === coworker1 && m.to_name === coworker2) || (m.from_name === coworker2 && m.to_name === coworker1)
    )

    if (startTime) {
      filtered = filtered.filter(m => m.created_at >= startTime)
    }
    if (endTime) {
      filtered = filtered.filter(m => m.created_at <= endTime)
    }

    return filtered.sort((a, b) => a.created_at.getTime() - b.created_at.getTime()).map(m => ({ ...m }))
  }

  async countUnreadBySender(recipientName: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>()
    const messages = this.messages.filter(m => m.to_name === recipientName && !m.read)
    for (const message of messages) {
      const count = counts.get(message.from_name) ?? 0
      counts.set(message.from_name, count + 1)
    }
    return counts
  }

  async lastMessageAtByCoworker(humanName: string): Promise<Map<string, Date>> {
    const lastMessage = new Map<string, Date>()
    for (const message of this.messages) {
      if (message.from_name === humanName || message.to_name === humanName) {
        const coworker = message.from_name === humanName ? message.to_name : message.from_name
        const current = lastMessage.get(coworker)
        if (!current || message.created_at > current) {
          lastMessage.set(coworker, message.created_at)
        }
      }
    }
    return lastMessage
  }

  async createMessage(from: string, to: string, body: string): Promise<MessageRow> {
    const message: MessageRow = {
      id: this.messageIdCounter++,
      from_name: from,
      to_name: to,
      body,
      read: false,
      injected: false,
      notified: false,
      created_at: new Date(),
    }
    this.messages.push(message)
    this.notifyWatchers()
    return message
  }

  async markMessageAsRead(id: number): Promise<MessageRow | null> {
    const message = this.messages.find(m => m.id === id)
    if (message) {
      message.read = true
    }
    return message ?? null
  }

  async markMessageAsInjected(id: number): Promise<void> {
    const message = this.messages.find(m => m.id === id)
    if (message) {
      message.injected = true
    }
  }

  async markMessagesAsNotified(ids: number[]): Promise<void> {
    for (const id of ids) {
      const message = this.messages.find(m => m.id === id)
      if (message) {
        message.notified = true
      }
    }
  }

  async deleteMessagesForCoworker(name: string): Promise<void> {
    this.messages = this.messages.filter(m => m.from_name !== name && m.to_name !== name)
  }

  // Cron Jobs
  async listCronJobs(): Promise<CronJobRow[]> {
    return [...this.cronJobs].sort((a, b) => a.name.localeCompare(b.name))
  }

  async listCronJobsForSession(sessionName: string): Promise<CronJobRow[]> {
    return this.cronJobs.filter(c => c.session_name === sessionName).sort((a, b) => a.name.localeCompare(b.name))
  }

  async getCronJobById(id: number): Promise<CronJobRow | null> {
    return this.cronJobs.find(c => c.id === id) ?? null
  }

  async getCronJobByNameAndSession(name: string, sessionName: string): Promise<CronJobRow | null> {
    return this.cronJobs.find(c => c.name === name && c.session_name === sessionName) ?? null
  }

  async createCronJob(
    name: string,
    sessionName: string,
    schedule: string,
    timezone: string,
    message: string
  ): Promise<CronJobRow> {
    const cronJob: CronJobRow = {
      id: this.cronJobIdCounter++,
      name,
      session_name: sessionName,
      schedule,
      timezone,
      message,
      enabled: true,
      created_at: new Date(),
      last_run: null,
    }
    this.cronJobs.push(cronJob)
    return cronJob
  }

  async deleteCronJob(id: number): Promise<void> {
    const index = this.cronJobs.findIndex(c => c.id === id)
    if (index !== -1) {
      this.cronJobs.splice(index, 1)
    }
  }

  async enableCronJob(id: number): Promise<void> {
    const cronJob = this.cronJobs.find(c => c.id === id)
    if (cronJob) {
      cronJob.enabled = true
    }
  }

  async disableCronJob(id: number): Promise<void> {
    const cronJob = this.cronJobs.find(c => c.id === id)
    if (cronJob) {
      cronJob.enabled = false
    }
  }

  async updateCronJobLastRun(id: number, lastRun: Date): Promise<void> {
    const cronJob = this.cronJobs.find(c => c.id === id)
    if (cronJob) {
      cronJob.last_run = lastRun
    }
  }

  async cronJobExistsForSession(name: string, sessionName: string): Promise<boolean> {
    return this.cronJobs.some(c => c.name === name && c.session_name === sessionName)
  }

  // Cron History
  async listCronHistory(cronJobId: number, limit: number): Promise<CronHistoryRow[]> {
    return this.cronHistory
      .filter(h => h.cron_job_id === cronJobId)
      .sort((a, b) => b.executed_at.getTime() - a.executed_at.getTime())
      .slice(0, limit)
  }

  async createCronHistory(cronJobId: number, executedAt: Date, success: boolean, errorMessage?: string): Promise<void> {
    const history: CronHistoryRow = {
      id: this.cronHistoryIdCounter++,
      cron_job_id: cronJobId,
      executed_at: executedAt,
      success,
      error_message: errorMessage ?? null,
    }
    this.cronHistory.push(history)
  }

  // Cron Requests
  async listCronRequests(filters?: { status?: string; sessionName?: string }): Promise<CronRequestRow[]> {
    let requests = [...this.cronRequests]

    if (filters?.status) {
      requests = requests.filter(r => r.status === filters.status)
    }
    if (filters?.sessionName) {
      requests = requests.filter(r => r.session_name === filters.sessionName)
    }

    return requests.sort((a, b) => b.requested_at.getTime() - a.requested_at.getTime())
  }

  async getCronRequestById(id: number): Promise<CronRequestRow | null> {
    return this.cronRequests.find(r => r.id === id) ?? null
  }

  async createCronRequest(
    name: string,
    sessionName: string,
    schedule: string,
    timezone: string,
    message: string
  ): Promise<CronRequestRow> {
    const request: CronRequestRow = {
      id: this.cronRequestIdCounter++,
      name,
      session_name: sessionName,
      schedule,
      timezone,
      message,
      status: 'pending',
      requested_at: new Date(),
      reviewed_at: null,
      reviewed_by: null,
      reviewer_notes: null,
    }
    this.cronRequests.push(request)
    return request
  }

  async updateCronRequestStatus(
    id: number,
    status: 'approved' | 'rejected',
    reviewedBy: string,
    reviewerNotes?: string
  ): Promise<CronRequestRow | null> {
    const request = this.cronRequests.find(r => r.id === id)
    if (request) {
      request.status = status
      request.reviewed_at = new Date()
      request.reviewed_by = reviewedBy
      request.reviewer_notes = reviewerNotes ?? null
    }
    return request ?? null
  }

  async deleteCronRequest(id: number): Promise<void> {
    const index = this.cronRequests.findIndex(r => r.id === id)
    if (index !== -1) {
      this.cronRequests.splice(index, 1)
    }
  }

  // Tasks
  async listTasks(): Promise<TaskRow[]> {
    return [...this.tasks].sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
  }

  async getTaskById(id: number): Promise<TaskRow | null> {
    return this.tasks.find(t => t.id === id) ?? null
  }

  async createTask(
    title: string,
    description: string,
    assignee: string | null,
    column: string,
    dependencies: number[]
  ): Promise<TaskRow> {
    const now = new Date()
    const task: TaskRow = {
      id: this.taskIdCounter++,
      title,
      description,
      assignee,
      column,
      dependencies,
      created_at: now,
      updated_at: now,
    }
    this.tasks.push(task)
    return task
  }

  async updateTask(
    id: number,
    updates: Partial<Pick<TaskRow, 'title' | 'description' | 'assignee' | 'column' | 'dependencies'>>
  ): Promise<TaskRow | null> {
    const task = this.tasks.find(t => t.id === id)
    if (task) {
      if (updates.title !== undefined) task.title = updates.title
      if (updates.description !== undefined) task.description = updates.description
      if (updates.assignee !== undefined) task.assignee = updates.assignee
      if (updates.column !== undefined) task.column = updates.column
      if (updates.dependencies !== undefined) task.dependencies = updates.dependencies
      task.updated_at = new Date()
    }
    return task ?? null
  }

  async deleteTask(id: number): Promise<void> {
    const index = this.tasks.findIndex(t => t.id === id)
    if (index !== -1) {
      this.tasks.splice(index, 1)
    }
  }

  async searchTasks(query: string, filters?: { assignee?: string; column?: string }): Promise<TaskRow[]> {
    let tasks = this.tasks.filter(t => t.title.includes(query) || t.description.includes(query))

    if (filters?.assignee) {
      tasks = tasks.filter(t => t.assignee === filters.assignee)
    }
    if (filters?.column) {
      tasks = tasks.filter(t => t.column === filters.column)
    }

    return tasks.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
  }

  async listTaskHistory(taskId: number): Promise<TaskHistoryRow[]> {
    return this.taskHistory
      .filter(h => h.task_id === taskId)
      .sort((a, b) => a.moved_at.getTime() - b.moved_at.getTime())
  }

  async createTaskHistory(taskId: number, fromColumn: string | null, toColumn: string): Promise<void> {
    const entry: TaskHistoryRow = {
      id: this.taskHistoryIdCounter++,
      task_id: taskId,
      from_column: fromColumn,
      to_column: toColumn,
      moved_at: new Date(),
    }
    this.taskHistory.push(entry)
  }

  // Migrations
  async runMigrations(): Promise<void> {
    // No-op for mock
  }
}

export function createMockStorage(): MockAgentOfficeStorage {
  return new MockAgentOfficeStorage()
}
