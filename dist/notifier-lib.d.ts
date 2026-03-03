export interface NotifyOptions {
    from: string;
    to: string;
    subject: string;
    text: string;
}
/**
 * Abstract notification interface — swap out the implementation
 * (email, SMS, webhook, etc.) without changing the daemon logic.
 */
export interface AgentOfficeNotifier {
    send(opts: NotifyOptions): Promise<void>;
}
export declare class ResendNotifier implements AgentOfficeNotifier {
    private resend;
    constructor(apiKey: string);
    send(opts: NotifyOptions): Promise<void>;
}
