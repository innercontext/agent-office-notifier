import { Cron } from "croner";
import { ResendNotifier } from "./notifier-lib.js";
import { execSync } from "child_process";
export async function notifier(options, customNotifier) {
    const toEmail = options.toEmail;
    if (!toEmail) {
        console.error("Error: --to-email or TO_EMAIL env required");
        process.exit(1);
    }
    const domain = options.domain;
    if (!domain) {
        console.error("Error: --domain or EMAIL_DOMAIN env required");
        process.exit(1);
    }
    const coworker = options.coworker;
    if (!coworker) {
        console.error("Error: --coworker is required");
        process.exit(1);
    }
    const sqlitePath = options.sqlite;
    const postgresUrl = options.postgresUrl;
    let dbFlag;
    if (sqlitePath) {
        dbFlag = `--sqlite "${sqlitePath}"`;
    }
    else if (postgresUrl) {
        dbFlag = `--postgres "${postgresUrl}"`;
    }
    else {
        // Default to SQLite if neither specified
        dbFlag = `--sqlite "agent-office.db"`;
    }
    const waitMinutes = parseInt(options.waitMinutes ?? "15", 10);
    const waitHours = waitMinutes / 60;
    let notify;
    if (customNotifier) {
        notify = customNotifier;
    }
    else {
        const resendApiKey = options.resendApiKey;
        if (!resendApiKey) {
            console.error("Error: --resend-api-key or RESEND_API_KEY env required");
            process.exit(1);
        }
        notify = new ResendNotifier(resendApiKey);
    }
    const check = async () => {
        try {
            // Fetch messages old enough to notify about
            const cmd1 = `node ../agent-office/dist/index.js ${dbFlag} list-messages-to-notify --json '{"coworker": "${coworker}", "hours": ${waitHours}}' --output json`;
            const output1 = execSync(cmd1, { encoding: 'utf8' });
            const qualifying = JSON.parse(output1.trim());
            if (qualifying.length === 0) {
                // Check if there are any unread messages at all (just not old enough yet)
                const cmd2 = `node ../agent-office/dist/index.js ${dbFlag} list-messages-to-notify --json '{"coworker": "${coworker}", "hours": 0}' --output json`;
                const output2 = execSync(cmd2, { encoding: 'utf8' });
                const allUnread = JSON.parse(output2.trim());
                if (allUnread.length > 0) {
                    console.log(`${allUnread.length} unread message(s) exist but haven't been waiting >${waitMinutes}m yet — skipping notification`);
                }
                else {
                    console.log("No unread messages — nothing to notify");
                }
                return;
            }
            const senders = [...new Set(qualifying.map((m) => m.from_name))];
            if (senders.length > 0) {
                const fromAddress = `Agent Office Notifications <notifications@${domain}>`;
                const subject = senders.length === 1 ? "Agent Office: Message Waiting" : "Agent Office: Messages Waiting";
                const text = senders.length === 1
                    ? `There is a message waiting for you at Agent Office from ${senders[0]}.`
                    : `There are messages waiting for you at Agent Office from: ${senders.join(', ')}.`;
                await notify.send({
                    from: fromAddress,
                    to: toEmail,
                    subject,
                    text,
                });
                console.log(`Sent out notification for waiting mail | from: ${senders.join(', ')} | to: ${toEmail}`);
            }
            const ids = qualifying.map((m) => m.id);
            const idsJson = JSON.stringify(ids);
            const cmd3 = `node ../agent-office/dist/index.js ${dbFlag} mark-messages-as-notified --json '{"ids": ${idsJson}}' --output json`;
            execSync(cmd3, { encoding: 'utf8' });
        }
        catch (e) {
            console.error("Notifier cron error:", e);
        }
    };
    const cron = new Cron("0 * * * *", check);
    console.log(`Agent Office notifier started. Notifying for messages unread >${waitMinutes}m. Checking database every hour. ^C to stop.`);
    await check();
    const shutdown = async () => {
        console.log("\nShutting down...");
        cron.stop();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
