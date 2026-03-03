import { Resend } from "resend";
export class ResendNotifier {
    resend;
    constructor(apiKey) {
        this.resend = new Resend(apiKey);
    }
    async send(opts) {
        await this.resend.emails.send({
            from: opts.from,
            to: [opts.to],
            subject: opts.subject,
            text: opts.text,
        });
    }
}
