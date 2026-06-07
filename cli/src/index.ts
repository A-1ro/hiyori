import { Command } from 'commander'
import { loginCommand } from './commands/login.js'
import { logoutCommand } from './commands/logout.js'
import { whoamiCommand } from './commands/whoami.js'
import { configCommand } from './commands/config.js'
import { eventListCommand } from './commands/event-list.js'
import { eventShowCommand } from './commands/event-show.js'
import { tallyCommand } from './commands/tally.js'
import { busyCommand } from './commands/busy.js'
import { icsCommand } from './commands/ics.js'

const program = new Command()

program
  .name('hiyori')
  .description('Hiyori CLI')
  .version('0.0.0')
  .option('--api-url <url>', 'API URL')
  .option('--json', 'Output as JSON')

program.addCommand(loginCommand())
program.addCommand(logoutCommand())
program.addCommand(whoamiCommand())
program.addCommand(configCommand())

const eventCmd = new Command('event').description('Event commands')
eventCmd.addCommand(eventListCommand())
eventCmd.addCommand(eventShowCommand())
program.addCommand(eventCmd)

program.addCommand(tallyCommand())
program.addCommand(busyCommand())
program.addCommand(icsCommand())

await program.parseAsync()
