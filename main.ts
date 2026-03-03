#!/usr/bin/env node

import { Command } from 'commander'
import { notifier } from './notifier.js'

const program = new Command()

program
  .name('agent-office-notifier')
  .description('Standalone notifier for Agent Office')
  .version('0.1.0')

program
  .command('start')
  .description('Start the notifier daemon')
  .requiredOption('--coworker <name>', 'Coworker name to monitor for unread messages')
  .option('--sqlite <path>', 'SQLite database file path', 'agent-office.db')
  .option('--postgres-url <url>', 'PostgreSQL connection URL')
  .option('--to-email <email>', 'Email address to send notifications to')
  .option('--resend-api-key <key>', 'Resend API key for sending emails')
  .option('--domain <domain>', 'Email domain for from addresses')
  .option('--wait-minutes <minutes>', 'Minutes to wait before notifying', '15')
  .action(async (options) => {
    await notifier(options)
  })

program.parse()