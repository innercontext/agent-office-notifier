import { type AgentOfficeNotifier } from "./notifier-lib.js";
type Options = {
    sqlite?: string;
    postgresUrl?: string;
    coworker?: string;
    toEmail?: string;
    resendApiKey?: string;
    domain?: string;
    waitMinutes?: string;
};
export declare function notifier(options: Options, customNotifier?: AgentOfficeNotifier): Promise<void>;
export {};
