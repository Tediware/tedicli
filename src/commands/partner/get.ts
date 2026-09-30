import {Args} from '@oclif/core'

import {PlatformCommand, SERVER_DATA} from '../../platform-base-command.js'
import {PartnerDetail, PartnerEnvelope, PartnerFlow, PartnerTransactionSet, PartnerWebhook} from '../../lib/platform.js'
import {cell, renderTable} from '../../lib/table.js'

export default class PartnerGet extends PlatformCommand<typeof PartnerGet> {
  static summary = 'Show one partner: connection, envelopes, webhooks, transaction sets with readiness, flows.'

  static description = `${SERVER_DATA}

READY is derived here from the server's facts: an outbound set is ready when a mapping or implementation is attached and the partner has an outbound flow with status active; an inbound set when it has an active inbound flow. A flow is a separate setup step, built and activated in the Tediware app; nothing in this CLI or on the API creates or activates one, so a direction with no flow reads "no outbound flow (build it in the app)" and a pending flow reads "outbound flow pending (activate it in the app)". Under --json the response is the server's partner shape unchanged, which carries the facts and not the verdict.`

  static examples = ['<%= config.bin %> partner get ACME', '<%= config.bin %> partner get ACME --json']

  static args = {
    key: Args.string({description: 'Partner key (case-insensitive).', required: true}),
  }

  async run(): Promise<PartnerDetail> {
    const client = await this.getAuthedClient()
    const partner = await client.partnerGet(this.requireId(this.args.key, 'partner key'))

    this.log(`${partner.key}  ${partner.name}`)
    this.log(`Id             ${partner.id}`)
    if (partner.deliveryMethod) this.log(`Delivery       ${partner.deliveryMethod}`)
    if (partner.startingInterchangeControlNumber != null) {
      this.log(`Control nos.   ISA from ${partner.startingInterchangeControlNumber}, GS from ${partner.startingGroupControlNumber ?? '-'}`)
    }

    this.log('')
    if (partner.connection) {
      const c = partner.connection
      this.log(`Connection     ${c.name} (${c.kind})`)
      if (c.host) this.log(`  Host         ${c.host}${c.port ? `:${c.port}` : ''}${c.username ? ` as ${c.username}` : ''}`)
      if (c.inboundDirectory || c.outboundDirectory) {
        this.log(`  Directories  in ${cell(c.inboundDirectory)}, out ${cell(c.outboundDirectory)}`)
      }
      if (c.as2Identifier || c.partnerAs2Identifier) {
        this.log(`  AS2          us ${cell(c.as2Identifier)}, partner ${cell(c.partnerAs2Identifier)}${c.partnerUrl ? ` at ${c.partnerUrl}` : ''}`)
      }
      this.log(`  Provisioned  ${c.provisioned ? 'yes' : 'no'}${c.as2Ready !== undefined ? `, AS2 ready ${c.as2Ready ? 'yes' : 'no'}` : ''}`)
    } else {
      this.log('Connection     -')
    }

    this.log('')
    this.log(`Envelopes      ours ${envelope(partner.internalEnvelope)}`)
    this.log(`               theirs ${envelope(partner.externalEnvelope)}`)

    this.log('')
    this.log(`Webhooks       inbound ${webhook(partner.inboundWebhook)}`)
    this.log(`               outbound ${webhook(partner.outboundWebhook)}`)
    this.log(`               error ${webhook(partner.errorWebhook)}`)

    this.log('')
    this.log('Transaction sets:')
    const flowFor = (direction: string) => partner.flows.find((f) => f.direction === direction)
    this.log(
      renderTable([
        ['SET', 'DIRECTION', 'USAGE', 'DOCUMENT', 'READY'],
        ...partner.transactionSets.map((ts) => [
          ts.transactionSetIdentifier,
          ts.direction,
          cell(ts.usageIndicator),
          document(ts),
          ready(ts, flowFor(ts.direction)),
        ]),
      ]),
    )

    this.log('')
    this.log('Flows:')
    if (partner.flows.length === 0) this.log('  -  (none built yet: flows are built and activated in the Tediware app, from the partner page)')
    for (const f of partner.flows) this.log(`  ${f.direction.padEnd(9)} ${f.status.padEnd(8)} ${cell(f.name)}`)

    return partner
  }
}

function envelope(e: PartnerEnvelope | null): string {
  if (!e) return '-'
  return `${cell(e.interchangeExtidQualifier)} ${cell(e.interchangeExtid)} / GS ${cell(e.applicationCode)} (${e.name})`
}

function webhook(w: PartnerWebhook | null): string {
  return w ? `${w.url} (${w.kind})` : '-'
}

function document(ts: PartnerTransactionSet): string {
  if (ts.mapping) return `mapping: ${ts.mapping.name}`
  if (ts.implementation) return `implementation: ${ts.implementation.name}`
  return '-'
}

/**
 * The verdict the server deliberately leaves to the client. Outbound needs a
 * document to generate from and an active flow to carry it; inbound needs
 * only the flow, since a received document is translated whether or not a
 * mapping is attached. The flow reasons say where the fix is, since the flow
 * is the one prerequisite that cannot be seen or changed from here.
 */
function ready(ts: PartnerTransactionSet, flow: PartnerFlow | undefined): string {
  const reasons: string[] = []
  if (!flow) reasons.push(`no ${ts.direction} flow (build it in the app)`)
  else if (flow.status !== 'active') reasons.push(`${ts.direction} flow ${flow.status} (activate it in the app)`)
  if (ts.direction === 'outbound' && !ts.mapping && !ts.implementation) reasons.push('no mapping or implementation')
  return reasons.length === 0 ? 'yes' : `no (${reasons.join('; ')})`
}
