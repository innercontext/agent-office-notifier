# Agent Office Notifier

Standalone notifier for Agent Office that sends email notifications for unread messages.

## Installation

```bash
npm install -g agent-office-notifier
```

## Usage

Start the notifier daemon:

```bash
agent-office-notifier start --coworker "John Doe" --to-email "your@email.com" --resend-api-key "your-resend-api-key" --domain "yourdomain.com"
```

### Options

- `--coworker <name>`: Coworker name to monitor for unread messages (required)
- `--sqlite <path>`: SQLite database file path (default: "agent-office.db")
- `--to-email <email>`: Email address to send notifications to (required)
- `--resend-api-key <key>`: Resend API key for sending emails (required)
- `--domain <domain>`: Email domain for from addresses (required)
- `--wait-minutes <minutes>`: Minutes to wait before notifying (default: "15")

## License

MIT