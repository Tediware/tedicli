import {BaseCommand} from '../../base-command.js'
import {assertValidBaseUrl} from '../../lib/config-store.js'
import {NotAuthenticatedError} from '../../lib/errors.js'
import {httpForwarder, runBridge} from '../../lib/mcp-bridge.js'

export default class McpServe extends BaseCommand<typeof McpServe> {
  static description =
    'Serve the Tediware MCP server over stdio, for agents that launch MCP servers as subprocesses. ' +
    'Forwards every request to the platform with your stored credential; holds no tool logic of its own.'

  static examples = [
    {
      description: 'Register with Claude Code',
      command: 'claude mcp add tediware -- <%= config.bin %> mcp serve',
    },
    {
      description: 'Register with Codex',
      command: 'codex mcp add tediware -- <%= config.bin %> mcp serve',
    },
  ]

  async run(): Promise<void> {
    // Resolved once, before the first line is read: a missing key is a
    // configuration problem for the person, so it is reported on stderr with
    // the usual exit code rather than as a JSON-RPC error to an agent that
    // cannot log in for them.
    const cred = await this.resolveCredentials()
    if (!cred) throw new NotAuthenticatedError()

    const baseUrl = await this.configStore.get('api.baseUrl')
    assertValidBaseUrl(baseUrl)

    await runBridge({
      input: process.stdin,
      output: process.stdout,
      stderr: process.stderr,
      forward: httpForwarder({baseUrl, token: cred.token}),
    })
  }
}
