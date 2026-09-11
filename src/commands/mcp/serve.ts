import {BaseCommand} from '../../base-command.js'
import {NotAuthenticatedError} from '../../lib/errors.js'
import {httpForwarder, runBridge} from '../../lib/mcp-bridge.js'

export default class McpServe extends BaseCommand<typeof McpServe> {
  static summary = 'Serve the Tediware MCP server over stdio, for agents that launch MCP servers as subprocesses.'

  static description =
    'Forwards every request to the Tediware server with your stored credential; holds no tool logic of its own. ' +
    'Answers the legacy initialize handshake locally so current hosts can connect. SIGINT and SIGTERM finish in-flight requests, then exit 0.'

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
    const baseUrl = await this.baseUrl()
    const cred = await this.resolveCredentials()
    if (!cred) throw new NotAuthenticatedError(baseUrl)

    // A signal is the bridge's graceful shutdown: it drains what is in flight
    // and returns, and the process exits 0 instead of 130 or 143.
    const shutdown = new AbortController()
    const stop = () => shutdown.abort()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)

    await runBridge({
      input: process.stdin,
      output: process.stdout,
      stderr: process.stderr,
      forward: httpForwarder({baseUrl, token: cred.token, userAgent: this.userAgent}),
      version: this.config.version,
      shutdown: shutdown.signal,
    })
    // stdin is still open; without this the event loop would keep waiting on it.
    process.stdin.destroy()
  }
}
