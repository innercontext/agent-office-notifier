export class AgentOfficeStorageBase {
    // Internal memory model: recipient name -> (sender name -> last received mail datetime)
    coworkerMailState = new Map();
    listeners = new Set();
    initialized = false;
    /**
     * Initialize the internal memory model by fetching all sessions and their last received mail times.
     * This is called automatically on first watch() call.
     */
    async initializeState() {
        if (this.initialized)
            return;
        // Get all sessions (these are all coworkers/agents)
        const sessions = await this.listSessions();
        // Initialize all coworkers with empty sender maps
        for (const session of sessions) {
            this.coworkerMailState.set(session.name, new Map());
        }
        // For each session, find all messages sent to them and track the latest per sender
        for (const session of sessions) {
            const messages = await this.listMessagesForRecipient(session.name);
            const senderMap = this.coworkerMailState.get(session.name);
            for (const message of messages) {
                const existingDate = senderMap.get(message.from_name);
                if (!existingDate || message.created_at > existingDate) {
                    senderMap.set(message.from_name, message.created_at);
                }
            }
        }
        this.initialized = true;
    }
    /**
     * Build the current watch state from internal memory model
     */
    buildWatchState() {
        const state = {};
        // Get all agent names sorted
        const agentNames = Array.from(this.coworkerMailState.keys()).sort();
        for (const agentName of agentNames) {
            const senderMap = this.coworkerMailState.get(agentName);
            state[agentName] = {};
            // Get all senders for this agent
            const senders = Array.from(senderMap.keys());
            for (const sender of senders) {
                const date = senderMap.get(sender);
                state[agentName][sender] = { lastSent: date.toISOString() };
            }
        }
        return state;
    }
    /**
     * Notify all listeners with the current state
     */
    notifyListeners() {
        const state = this.buildWatchState();
        for (const listener of this.listeners) {
            try {
                listener(state);
            }
            catch (error) {
                console.error('Error in watch listener:', error);
            }
        }
    }
    /**
     * Watch for changes to coworker mail state.
     * Returns an unsubscribe function.
     */
    watch(listener) {
        // Add listener to the set first
        this.listeners.add(listener);
        // Initialize state on first watch call
        this.initializeState().then(() => {
            // Only notify if listener is still subscribed
            if (!this.listeners.has(listener))
                return;
            // Notify the new listener with current state immediately
            const state = this.buildWatchState();
            try {
                listener(state);
            }
            catch (error) {
                console.error('Error in initial watch listener call:', error);
            }
        });
        // Return unsubscribe function
        return () => {
            this.listeners.delete(listener);
        };
    }
    /**
     * Implementation of createMessage from AgentOfficeStorage interface.
     * Calls the subclass implementation and then notifies watchers.
     */
    async createMessage(from, to, body) {
        // Call subclass implementation to actually create the message
        const message = await this.createMessageImpl(from, to, body);
        // Update the internal memory model
        let senderMap = this.coworkerMailState.get(to);
        if (!senderMap) {
            // This can happen if a new coworker was added after initialization
            senderMap = new Map();
            this.coworkerMailState.set(to, senderMap);
        }
        const existingDate = senderMap.get(from);
        if (!existingDate || message.created_at > existingDate) {
            senderMap.set(from, message.created_at);
            // Notify all listeners of the update
            this.notifyListeners();
        }
        return message;
    }
}
