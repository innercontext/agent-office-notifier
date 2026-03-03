import { Cron } from "croner"
import { ResendNotifier, type AgentOfficeNotifier } from "./notifier-lib.js"
import { execSync } from "child_process"

type Options = {
  sqlite?: string
  coworker?: string
  toEmail?: string
  resendApiKey?: string
  domain?: string
  waitMinutes?: string
}

export async function notifier(options: Options, customNotifier?: AgentOfficeNotifier): Promise<void> {
  const toEmail = options.toEmail
  if (!toEmail) {
    console.error("Error: --to-email or TO_EMAIL env required")
    process.exit(1)
  }

  const domain = options.domain
  if (!domain) {
    console.error("Error: --domain or EMAIL_DOMAIN env required")
    process.exit(1)
  }

  const coworker = options.coworker
  if (!coworker) {
    console.error("Error: --coworker is required")
    process.exit(1)
  }

  const sqlitePath = options.sqlite ?? "agent-office.db"

  const waitMinutes = parseInt(options.waitMinutes ?? "15", 10)
  const waitHours = waitMinutes / 60

  let notify: AgentOfficeNotifier
  if (customNotifier) {
    notify = customNotifier
  } else {
    const resendApiKey = options.resendApiKey
    if (!resendApiKey) {
      console.error("Error: --resend-api-key or RESEND_API_KEY env required")
      process.exit(1)
    }
    notify = new ResendNotifier(resendApiKey)
  }



  const check = async () => {
    try {
      // Fetch messages old enough to notify about
      const cmd1 = `node ../agent-office/dist/index.js --sqlite "${sqlitePath}" list-messages-to-notify --coworker "${coworker}" --hours ${waitHours} --json`
      const output1 = execSync(cmd1, { encoding: 'utf8' })
      const qualifying = JSON.parse(output1.trim())

      if (qualifying.length === 0) {
        // Check if there are any unread messages at all (just not old enough yet)
        const cmd2 = `node ../agent-office/dist/index.js --sqlite "${sqlitePath}" list-messages-to-notify --coworker "${coworker}" --hours 0 --json`
        const output2 = execSync(cmd2, { encoding: 'utf8' })
        const allUnread = JSON.parse(output2.trim())
        if (allUnread.length > 0) {
          console.log(`${allUnread.length} unread message(s) exist but haven't been waiting >${waitMinutes}m yet — skipping notification`)
        } else {
          console.log("No unread messages — nothing to notify")
        }
        return
      }

      const senders = [...new Set(qualifying.map((m: any) => m.from_name))] as string[]
      for (const sender of senders) {
        const fromAddress = `${sender} <${sender.replace(/\s+/g, "+")}@${domain}>`
        await notify.send({
          from: fromAddress,
          to: toEmail,
          subject: "Agent Office: Message Waiting",
          text: "There is a message waiting for you at Agent Office.",
        })
        console.log(`Sent out notification for waiting mail | from: ${fromAddress} | to: ${toEmail}`)
      }

      const ids = qualifying.map((m: any) => m.id)
      const idsStr = ids.join(',')
      const cmd3 = `node ../agent-office/dist/index.js --sqlite "${sqlitePath}" mark-messages-as-notified --ids ${idsStr} --json`
      execSync(cmd3, { encoding: 'utf8' })
    } catch (e) {
      console.error("Notifier cron error:", e)
    }
  }

  const cron = new Cron("0 * * * *", check)

  console.log(`Agent Office notifier started. Notifying for messages unread >${waitMinutes}m. Checking database every hour. ^C to stop.`)
  await check()

  const shutdown = async () => {
    console.log("\nShutting down...")
    cron.stop()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}
