import type { AgentOfficeStorage, WatchListener, WatchState, SenderInfo } from './storage.js'
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

export { WatchListener, WatchState, SenderInfo }

export abstract class AgentOfficeStorageBase implements AgentOfficeStorage {
  // Internal memory model: recipient name -> (sender name -> last received mail datetime)
  private coworkerMailState: Map<string, Map<string, Date>> = new Map()
  private listeners: Set<WatchListener> = new Set()
  private initialized: boolean = false

  // Abstract methods from AgentOfficeStorage interface
  abstract close(): Promise<void>
  abstract begin<T>(callback: (tx: AgentOfficeStorage) => Promise<T>): Promise<T>
  abstract listSessions(): Promise<SessionRow[]>
  abstract getSessionByName(name: string): Promise<SessionRow | null>
  abstract getSessionIdByName(name: string): Promise<number | null>
  abstract createSession(name: string, coworkerType: string): Promise<SessionRow>
  abstract deleteSession(id: number): Promise<void>
  abstract updateSession(
    name: string,
    updates: Partial<Pick<SessionRow, 'coworkerType' | 'status' | 'description' | 'philosophy' | 'visual_description'>>
  ): Promise<SessionRow | null>
  abstract sessionExists(name: string): Promise<boolean>
  abstract getAllConfig(): Promise<ConfigRow[]>
  abstract getConfig(key: string): Promise<string | null>
  abstract setConfig(key: string, value: string): Promise<void>
  abstract listMessagesForRecipient(
    name: string,
    filters?: { unread?: boolean; olderThanHours?: number; notified?: boolean }
  ): Promise<MessageRow[]>
  abstract listMessagesFromSender(name: string): Promise<MessageRow[]>
  abstract listMessagesBetween(
    coworker1: string,
    coworker2: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<MessageRow[]>
  abstract countUnreadBySender(recipientName: string): Promise<Map<string, number>>
  abstract lastMessageAtByCoworker(humanName: string): Promise<Map<string, Date>>
  abstract markMessageAsRead(id: number): Promise<MessageRow | null>
  abstract markMessageAsInjected(id: number): Promise<void>
  abstract markMessagesAsNotified(ids: number[]): Promise<void>
  abstract deleteMessagesForCoworker(name: string): Promise<void>
  abstract listCronJobs(): Promise<CronJobRow[]>
  abstract listCronJobsForSession(sessionName: string): Promise<CronJobRow[]>
  abstract getCronJobById(id: number): Promise<CronJobRow | null>
  abstract getCronJobByNameAndSession(name: string, sessionName: string): Promise<CronJobRow | null>
  abstract createCronJob(
    name: string,
    sessionName: string,
    schedule: string,
    timezone: string,
    message: string
  ): Promise<CronJobRow>
  abstract deleteCronJob(id: number): Promise<void>
  abstract enableCronJob(id: number): Promise<void>
  abstract disableCronJob(id: number): Promise<void>
  abstract updateCronJobLastRun(id: number, lastRun: Date): Promise<void>
  abstract cronJobExistsForSession(name: string, sessionName: string): Promise<boolean>
  abstract listCronHistory(cronJobId: number, limit: number): Promise<CronHistoryRow[]>
  abstract createCronHistory(
    cronJobId: number,
    executedAt: Date,
    success: boolean,
    errorMessage?: string
  ): Promise<void>
  abstract listCronRequests(filters?: { status?: string; sessionName?: string }): Promise<CronRequestRow[]>
  abstract getCronRequestById(id: number): Promise<CronRequestRow | null>
  abstract createCronRequest(
    name: string,
    sessionName: string,
    schedule: string,
    timezone: string,
    message: string
  ): Promise<CronRequestRow>
  abstract updateCronRequestStatus(
    id: number,
    status: 'approved' | 'rejected',
    reviewedBy: string,
    reviewerNotes?: string
  ): Promise<CronRequestRow | null>
  abstract deleteCronRequest(id: number): Promise<void>
  abstract listTasks(): Promise<TaskRow[]>
  abstract getTaskById(id: number): Promise<TaskRow | null>
  abstract createTask(
    title: string,
    description: string,
    assignee: string | null,
    column: string,
    dependencies: number[]
  ): Promise<TaskRow>
  abstract updateTask(
    id: number,
    updates: Partial<Pick<TaskRow, 'title' | 'description' | 'assignee' | 'column' | 'dependencies'>>
  ): Promise<TaskRow | null>
  abstract deleteTask(id: number): Promise<void>
  abstract searchTasks(query: string, filters?: { assignee?: string; column?: string }): Promise<TaskRow[]>

  // Task History - subclasses must implement
  abstract listTaskHistory(taskId: number): Promise<TaskHistoryRow[]>
  abstract createTaskHistory(taskId: number, fromColumn: string | null, toColumn: string): Promise<void>

  abstract runMigrations(): Promise<void>

  // createMessage needs special handling - subclasses must implement the DB logic
  // but call this base method to notify watchers
  abstract createMessageImpl(from: string, to: string, body: string): Promise<MessageRow>

  /**
   * Initialize the internal memory model by fetching all sessions and their last received mail times.
   * This is called automatically on first watch() call.
   */
  private async initializeState(): Promise<void> {
    if (this.initialized) return

    // Get all sessions (these are all coworkers/agents)
    const sessions = await this.listSessions()

    // Initialize all coworkers with empty sender maps
    for (const session of sessions) {
      this.coworkerMailState.set(session.name, new Map())
    }

    // For each session, find all messages sent to them and track the latest per sender
    for (const session of sessions) {
      const messages = await this.listMessagesForRecipient(session.name)
      const senderMap = this.coworkerMailState.get(session.name)!

      for (const message of messages) {
        const existingDate = senderMap.get(message.from_name)
        if (!existingDate || message.created_at > existingDate) {
          senderMap.set(message.from_name, message.created_at)
        }
      }
    }

    this.initialized = true
  }

  /**
   * Build the current watch state from internal memory model
   */
  private buildWatchState(): WatchState {
    const state: WatchState = {}

    // Get all agent names sorted
    const agentNames = Array.from(this.coworkerMailState.keys()).sort()

    for (const agentName of agentNames) {
      const senderMap = this.coworkerMailState.get(agentName)!
      state[agentName] = {}

      // Get all senders for this agent
      const senders = Array.from(senderMap.keys())

      for (const sender of senders) {
        const date = senderMap.get(sender)!
        state[agentName][sender] = { lastSent: date.toISOString() }
      }
    }

    return state
  }

  /**
   * Notify all listeners with the current state
   */
  private notifyListeners(): void {
    const state = this.buildWatchState()

    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch (error) {
        console.error('Error in watch listener:', error)
      }
    }
  }

  /**
   * Watch for changes to coworker mail state.
   * Returns an unsubscribe function.
   */
  watch(listener: WatchListener): () => void {
    // Add listener to the set first
    this.listeners.add(listener)

    // Initialize state on first watch call
    this.initializeState().then(() => {
      // Only notify if listener is still subscribed
      if (!this.listeners.has(listener)) return

      // Notify the new listener with current state immediately
      const state = this.buildWatchState()

      try {
        listener(state)
      } catch (error) {
        console.error('Error in initial watch listener call:', error)
      }
    })

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Implementation of createMessage from AgentOfficeStorage interface.
   * Calls the subclass implementation and then notifies watchers.
   */
  async createMessage(from: string, to: string, body: string): Promise<MessageRow> {
    // Call subclass implementation to actually create the message
    const message = await this.createMessageImpl(from, to, body)

    // Update the internal memory model
    let senderMap = this.coworkerMailState.get(to)
    if (!senderMap) {
      // This can happen if a new coworker was added after initialization
      senderMap = new Map()
      this.coworkerMailState.set(to, senderMap)
    }

    const existingDate = senderMap.get(from)
    if (!existingDate || message.created_at > existingDate) {
      senderMap.set(from, message.created_at)
      // Notify all listeners of the update
      this.notifyListeners()
    }

    return message
  }
}
