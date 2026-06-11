import { Command } from 'commander'
import { loginCommand } from './commands/login.js'
import { logoutCommand } from './commands/logout.js'
import { whoamiCommand } from './commands/whoami.js'
import { configCommand } from './commands/config.js'
import { eventListCommand } from './commands/event-list.js'
import { eventShowCommand } from './commands/event-show.js'
import { eventCreateCommand } from './commands/event-create.js'
import { eventEditCommand } from './commands/event-edit.js'
import { eventRmCommand } from './commands/event-rm.js'
import { tallyCommand } from './commands/tally.js'
import { busyCommand } from './commands/busy.js'
import { icsCommand } from './commands/ics.js'
import { candidateCommand } from './commands/candidate.js'
import { voteCommand } from './commands/vote.js'
import { confirmCommand, unconfirmCommand } from './commands/confirm.js'
import { subCommand } from './commands/sub.js'

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
eventCmd.addCommand(eventCreateCommand())
eventCmd.addCommand(eventEditCommand())
eventCmd.addCommand(eventRmCommand())
program.addCommand(eventCmd)

program.addCommand(tallyCommand())
program.addCommand(busyCommand())
program.addCommand(icsCommand())

program.addCommand(candidateCommand())
program.addCommand(voteCommand())
program.addCommand(confirmCommand())
program.addCommand(unconfirmCommand())
program.addCommand(subCommand())

await program.parseAsync()
