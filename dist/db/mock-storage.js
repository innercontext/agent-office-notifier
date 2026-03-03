export class MockAgentOfficeStorage {
    sessions = [];
    sessionIdCounter = 1;
    configs = [];
    messages = [];
    messageIdCounter = 1;
    cronJobs = [];
    cronJobIdCounter = 1;
    cronHistory = [];
    cronHistoryIdCounter = 1;
    cronRequests = [];
    cronRequestIdCounter = 1;
    tasks = [];
    taskIdCounter = 1;
    taskHistory = [];
    taskHistoryIdCounter = 1;
    listeners = new Set();
    closed = false;
    // Connection/Transaction
    async close() {
        this.closed = true;
    }
    isClosed() {
        return this.closed;
    }
    async begin(callback) {
        return callback(this);
    }
    // Watch
    watch(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    notifyWatchers() {
        const state = {};
        for (const message of this.messages) {
            if (!state[message.to_name]) {
                state[message.to_name] = {};
            }
            state[message.to_name][message.from_name] = {
                lastSent: message.created_at.toISOString(),
            };
        }
        for (const listener of this.listeners) {
            listener(state);
        }
    }
    // Sessions
    async listSessions() {
        return [...this.sessions].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    }
    async getSessionByName(name) {
        return this.sessions.find(s => s.name === name) ?? null;
    }
    async getSessionIdByName(name) {
        const session = this.sessions.find(s => s.name === name);
        return session?.id ?? null;
    }
    async createSession(name, coworkerType) {
        const newSession = {
            id: this.sessionIdCounter++,
            name,
            coworkerType,
            status: null,
            description: null,
            philosophy: null,
            visual_description: null,
            created_at: new Date(),
        };
        this.sessions.push(newSession);
        return newSession;
    }
    async deleteSession(id) {
        const index = this.sessions.findIndex(s => s.id === id);
        if (index !== -1) {
            this.sessions.splice(index, 1);
        }
    }
    async updateSession(name, updates) {
        const session = this.sessions.find(s => s.name === name);
        if (!session) {
            return null;
        }
        if (updates.coworkerType !== undefined)
            session.coworkerType = updates.coworkerType;
        if (updates.status !== undefined)
            session.status = updates.status;
        if (updates.description !== undefined)
            session.description = updates.description;
        if (updates.philosophy !== undefined)
            session.philosophy = updates.philosophy;
        if (updates.visual_description !== undefined)
            session.visual_description = updates.visual_description;
        return session;
    }
    async sessionExists(name) {
        return this.sessions.some(s => s.name === name);
    }
    // Config
    async getAllConfig() {
        return [...this.configs];
    }
    async getConfig(key) {
        const config = this.configs.find(c => c.key === key);
        return config?.value ?? null;
    }
    async setConfig(key, value) {
        const index = this.configs.findIndex(c => c.key === key);
        if (index !== -1) {
            this.configs[index].value = value;
        }
        else {
            this.configs.push({ key, value });
        }
    }
    // Messages
    async listMessagesForRecipient(name, filters) {
        let messages = this.messages.filter(m => m.to_name === name);
        if (filters?.unread) {
            messages = messages.filter(m => !m.read);
        }
        if (filters?.notified === false) {
            messages = messages.filter(m => !m.notified);
        }
        if (filters?.olderThanHours !== undefined) {
            const cutoff = new Date(Date.now() - filters.olderThanHours * 60 * 60 * 1000);
            messages = messages.filter(m => m.created_at < cutoff);
        }
        return messages.sort((a, b) => b.created_at.getTime() - a.created_at.getTime()).map(m => ({ ...m }));
    }
    async listMessagesFromSender(name) {
        return this.messages
            .filter(m => m.from_name === name)
            .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
            .map(m => ({ ...m }));
    }
    async listMessagesBetween(coworker1, coworker2, startTime, endTime) {
        let filtered = this.messages.filter(m => (m.from_name === coworker1 && m.to_name === coworker2) || (m.from_name === coworker2 && m.to_name === coworker1));
        if (startTime) {
            filtered = filtered.filter(m => m.created_at >= startTime);
        }
        if (endTime) {
            filtered = filtered.filter(m => m.created_at <= endTime);
        }
        return filtered.sort((a, b) => a.created_at.getTime() - b.created_at.getTime()).map(m => ({ ...m }));
    }
    async countUnreadBySender(recipientName) {
        const counts = new Map();
        const messages = this.messages.filter(m => m.to_name === recipientName && !m.read);
        for (const message of messages) {
            const count = counts.get(message.from_name) ?? 0;
            counts.set(message.from_name, count + 1);
        }
        return counts;
    }
    async lastMessageAtByCoworker(humanName) {
        const lastMessage = new Map();
        for (const message of this.messages) {
            if (message.from_name === humanName || message.to_name === humanName) {
                const coworker = message.from_name === humanName ? message.to_name : message.from_name;
                const current = lastMessage.get(coworker);
                if (!current || message.created_at > current) {
                    lastMessage.set(coworker, message.created_at);
                }
            }
        }
        return lastMessage;
    }
    async createMessage(from, to, body) {
        const message = {
            id: this.messageIdCounter++,
            from_name: from,
            to_name: to,
            body,
            read: false,
            injected: false,
            notified: false,
            created_at: new Date(),
        };
        this.messages.push(message);
        this.notifyWatchers();
        return message;
    }
    async markMessageAsRead(id) {
        const message = this.messages.find(m => m.id === id);
        if (message) {
            message.read = true;
        }
        return message ?? null;
    }
    async markMessageAsInjected(id) {
        const message = this.messages.find(m => m.id === id);
        if (message) {
            message.injected = true;
        }
    }
    async markMessagesAsNotified(ids) {
        for (const id of ids) {
            const message = this.messages.find(m => m.id === id);
            if (message) {
                message.notified = true;
            }
        }
    }
    async deleteMessagesForCoworker(name) {
        this.messages = this.messages.filter(m => m.from_name !== name && m.to_name !== name);
    }
    // Cron Jobs
    async listCronJobs() {
        return [...this.cronJobs].sort((a, b) => a.name.localeCompare(b.name));
    }
    async listCronJobsForSession(sessionName) {
        return this.cronJobs.filter(c => c.session_name === sessionName).sort((a, b) => a.name.localeCompare(b.name));
    }
    async getCronJobById(id) {
        return this.cronJobs.find(c => c.id === id) ?? null;
    }
    async getCronJobByNameAndSession(name, sessionName) {
        return this.cronJobs.find(c => c.name === name && c.session_name === sessionName) ?? null;
    }
    async createCronJob(name, sessionName, schedule, timezone, message) {
        const cronJob = {
            id: this.cronJobIdCounter++,
            name,
            session_name: sessionName,
            schedule,
            timezone,
            message,
            enabled: true,
            created_at: new Date(),
            last_run: null,
        };
        this.cronJobs.push(cronJob);
        return cronJob;
    }
    async deleteCronJob(id) {
        const index = this.cronJobs.findIndex(c => c.id === id);
        if (index !== -1) {
            this.cronJobs.splice(index, 1);
        }
    }
    async enableCronJob(id) {
        const cronJob = this.cronJobs.find(c => c.id === id);
        if (cronJob) {
            cronJob.enabled = true;
        }
    }
    async disableCronJob(id) {
        const cronJob = this.cronJobs.find(c => c.id === id);
        if (cronJob) {
            cronJob.enabled = false;
        }
    }
    async updateCronJobLastRun(id, lastRun) {
        const cronJob = this.cronJobs.find(c => c.id === id);
        if (cronJob) {
            cronJob.last_run = lastRun;
        }
    }
    async cronJobExistsForSession(name, sessionName) {
        return this.cronJobs.some(c => c.name === name && c.session_name === sessionName);
    }
    // Cron History
    async listCronHistory(cronJobId, limit) {
        return this.cronHistory
            .filter(h => h.cron_job_id === cronJobId)
            .sort((a, b) => b.executed_at.getTime() - a.executed_at.getTime())
            .slice(0, limit);
    }
    async createCronHistory(cronJobId, executedAt, success, errorMessage) {
        const history = {
            id: this.cronHistoryIdCounter++,
            cron_job_id: cronJobId,
            executed_at: executedAt,
            success,
            error_message: errorMessage ?? null,
        };
        this.cronHistory.push(history);
    }
    // Cron Requests
    async listCronRequests(filters) {
        let requests = [...this.cronRequests];
        if (filters?.status) {
            requests = requests.filter(r => r.status === filters.status);
        }
        if (filters?.sessionName) {
            requests = requests.filter(r => r.session_name === filters.sessionName);
        }
        return requests.sort((a, b) => b.requested_at.getTime() - a.requested_at.getTime());
    }
    async getCronRequestById(id) {
        return this.cronRequests.find(r => r.id === id) ?? null;
    }
    async createCronRequest(name, sessionName, schedule, timezone, message) {
        const request = {
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
        };
        this.cronRequests.push(request);
        return request;
    }
    async updateCronRequestStatus(id, status, reviewedBy, reviewerNotes) {
        const request = this.cronRequests.find(r => r.id === id);
        if (request) {
            request.status = status;
            request.reviewed_at = new Date();
            request.reviewed_by = reviewedBy;
            request.reviewer_notes = reviewerNotes ?? null;
        }
        return request ?? null;
    }
    async deleteCronRequest(id) {
        const index = this.cronRequests.findIndex(r => r.id === id);
        if (index !== -1) {
            this.cronRequests.splice(index, 1);
        }
    }
    // Tasks
    async listTasks() {
        return [...this.tasks].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    }
    async getTaskById(id) {
        return this.tasks.find(t => t.id === id) ?? null;
    }
    async createTask(title, description, assignee, column, dependencies) {
        const now = new Date();
        const task = {
            id: this.taskIdCounter++,
            title,
            description,
            assignee,
            column,
            dependencies,
            created_at: now,
            updated_at: now,
        };
        this.tasks.push(task);
        return task;
    }
    async updateTask(id, updates) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            if (updates.title !== undefined)
                task.title = updates.title;
            if (updates.description !== undefined)
                task.description = updates.description;
            if (updates.assignee !== undefined)
                task.assignee = updates.assignee;
            if (updates.column !== undefined)
                task.column = updates.column;
            if (updates.dependencies !== undefined)
                task.dependencies = updates.dependencies;
            task.updated_at = new Date();
        }
        return task ?? null;
    }
    async deleteTask(id) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            this.tasks.splice(index, 1);
        }
    }
    async searchTasks(query, filters) {
        let tasks = this.tasks.filter(t => t.title.includes(query) || t.description.includes(query));
        if (filters?.assignee) {
            tasks = tasks.filter(t => t.assignee === filters.assignee);
        }
        if (filters?.column) {
            tasks = tasks.filter(t => t.column === filters.column);
        }
        return tasks.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    }
    async listTaskHistory(taskId) {
        return this.taskHistory
            .filter(h => h.task_id === taskId)
            .sort((a, b) => a.moved_at.getTime() - b.moved_at.getTime());
    }
    async createTaskHistory(taskId, fromColumn, toColumn) {
        const entry = {
            id: this.taskHistoryIdCounter++,
            task_id: taskId,
            from_column: fromColumn,
            to_column: toColumn,
            moved_at: new Date(),
        };
        this.taskHistory.push(entry);
    }
    // Migrations
    async runMigrations() {
        // No-op for mock
    }
}
export function createMockStorage() {
    return new MockAgentOfficeStorage();
}
