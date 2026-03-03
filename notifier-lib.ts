import { Resend } from "resend"

export interface NotifyOptions {
  from: string
  to: string
  subject: string
  text: string
}

/**
 * Abstract notification interface — swap out the implementation
 * (email, SMS, webhook, etc.) without changing the daemon logic.
 */
export interface AgentOfficeNotifier {
  send(opts: NotifyOptions): Promise<void>
}

export class ResendNotifier implements AgentOfficeNotifier {
  private resend: Resend

  constructor(apiKey: string) {
    this.resend = new Resend(apiKey)
  }

  async send(opts: NotifyOptions): Promise<void> {
    await this.resend.emails.send({
      from: opts.from,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
    })
  }
}
