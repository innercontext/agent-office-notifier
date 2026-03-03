import type { AgentOfficeStorage, WatchListener, WatchState, SenderInfo } from './storage.js';
import type { SessionRow, ConfigRow, MessageRow, CronJobRow, CronHistoryRow, CronRequestRow, TaskRow, TaskHistoryRow } from './types.js';
export { WatchListener, WatchState, SenderInfo };
export declare abstract class AgentOfficeStorageBase implements AgentOfficeStorage {
    private coworkerMailState;
    private listeners;
    private initialized;
    abstract close(): Promise<void>;
    abstract begin<T>(callback: (tx: AgentOfficeStorage) => Promise<T>): Promise<T>;
    abstract listSessions(): Promise<SessionRow[]>;
    abstract getSessionByName(name: string): Promise<SessionRow | null>;
    abstract getSessionIdByName(name: string): Promise<number | null>;
    abstract createSession(name: string, coworkerType: string): Promise<SessionRow>;
    abstract deleteSession(id: number): Promise<void>;
    abstract updateSession(name: string, updates: Partial<Pick<SessionRow, 'coworkerType' | 'status' | 'description' | 'philosophy' | 'visual_description'>>): Promise<SessionRow | null>;
    abstract sessionExists(name: string): Promise<boolean>;
    abstract getAllConfig(): Promise<ConfigRow[]>;
    abstract getConfig(key: string): Promise<string | null>;
    abstract setConfig(key: string, value: string): Promise<void>;
    abstract listMessagesForRecipient(name: string, filters?: {
        unread?: boolean;
        olderThanHours?: number;
        notified?: boolean;
    }): Promise<MessageRow[]>;
    abstract listMessagesFromSender(name: string): Promise<MessageRow[]>;
    abstract listMessagesBetween(coworker1: string, coworker2: string, startTime?: Date, endTime?: Date): Promise<MessageRow[]>;
    abstract countUnreadBySender(recipientName: string): Promise<Map<string, number>>;
    abstract lastMessageAtByCoworker(humanName: string): Promise<Map<string, Date>>;
    abstract markMessageAsRead(id: number): Promise<MessageRow | null>;
    abstract markMessageAsInjected(id: number): Promise<void>;
    abstract markMessagesAsNotified(ids: number[]): Promise<void>;
    abstract deleteMessagesForCoworker(name: string): Promise<void>;
    abstract listCronJobs(): Promise<CronJobRow[]>;
    abstract listCronJobsForSession(sessionName: string): Promise<CronJobRow[]>;
    abstract getCronJobById(id: number): Promise<CronJobRow | null>;
    abstract getCronJobByNameAndSession(name: string, sessionName: string): Promise<CronJobRow | null>;
    abstract createCronJob(name: string, sessionName: string, schedule: string, timezone: string, message: string): Promise<CronJobRow>;
    abstract deleteCronJob(id: number): Promise<void>;
    abstract enableCronJob(id: number): Promise<void>;
    abstract disableCronJob(id: number): Promise<void>;
    abstract updateCronJobLastRun(id: number, lastRun: Date): Promise<void>;
    abstract cronJobExistsForSession(name: string, sessionName: string): Promise<boolean>;
    abstract listCronHistory(cronJobId: number, limit: number): Promise<CronHistoryRow[]>;
    abstract createCronHistory(cronJobId: number, executedAt: Date, success: boolean, errorMessage?: string): Promise<void>;
    abstract listCronRequests(filters?: {
        status?: string;
        sessionName?: string;
    }): Promise<CronRequestRow[]>;
    abstract getCronRequestById(id: number): Promise<CronRequestRow | null>;
    abstract createCronRequest(name: string, sessionName: string, schedule: string, timezone: string, message: string): Promise<CronRequestRow>;
    abstract updateCronRequestStatus(id: number, status: 'approved' | 'rejected', reviewedBy: string, reviewerNotes?: string): Promise<CronRequestRow | null>;
    abstract deleteCronRequest(id: number): Promise<void>;
    abstract listTasks(): Promise<TaskRow[]>;
    abstract getTaskById(id: number): Promise<TaskRow | null>;
    abstract createTask(title: string, description: string, assignee: string | null, column: string, dependencies: number[]): Promise<TaskRow>;
    abstract updateTask(id: number, updates: Partial<Pick<TaskRow, 'title' | 'description' | 'assignee' | 'column' | 'dependencies'>>): Promise<TaskRow | null>;
    abstract deleteTask(id: number): Promise<void>;
    abstract searchTasks(query: string, filters?: {
        assignee?: string;
        column?: string;
    }): Promise<TaskRow[]>;
    abstract listTaskHistory(taskId: number): Promise<TaskHistoryRow[]>;
    abstract createTaskHistory(taskId: number, fromColumn: string | null, toColumn: string): Promise<void>;
    abstract runMigrations(): Promise<void>;
    abstract createMessageImpl(from: string, to: string, body: string): Promise<MessageRow>;
    /**
     * Initialize the internal memory model by fetching all sessions and their last received mail times.
     * This is called automatically on first watch() call.
     */
    private initializeState;
    /**
     * Build the current watch state from internal memory model
     */
    private buildWatchState;
    /**
     * Notify all listeners with the current state
     */
    private notifyListeners;
    /**
     * Watch for changes to coworker mail state.
     * Returns an unsubscribe function.
     */
    watch(listener: WatchListener): () => void;
    /**
     * Implementation of createMessage from AgentOfficeStorage interface.
     * Calls the subclass implementation and then notifies watchers.
     */
    createMessage(from: string, to: string, body: string): Promise<MessageRow>;
}
