import type { ToolName } from './beacon'

export const toolDefinitions = {
  list_agents: {
    name: 'list_agents',
    description: 'List agents visible to the user',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  get_agent: {
    name: 'get_agent',
    description: 'Get detail for a single agent',
    parameters: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent id' },
      },
      required: ['agent_id'],
    },
  },
  enable_agent: {
    name: 'enable_agent',
    description: 'Enable an agent (mutating)',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'string' } },
      required: ['agent_id'],
    },
  },
  disable_agent: {
    name: 'disable_agent',
    description: 'Disable an agent (mutating)',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'string' } },
      required: ['agent_id'],
    },
  },
  delete_agent: {
    name: 'delete_agent',
    description: 'Delete an agent (mutating)',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'string' } },
      required: ['agent_id'],
    },
  },
  list_logs: {
    name: 'list_logs',
    description: 'Fetch logs for an agent or fleet',
    parameters: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', nullable: true },
        limit: { type: 'number', nullable: true },
      },
    },
  },
  list_metrics: {
    name: 'list_metrics',
    description: 'Fetch metrics for an agent',
    parameters: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        metric_type: { type: 'string', nullable: true },
        limit: { type: 'number', nullable: true },
      },
      required: ['agent_id'],
    },
  },
  list_users: {
    name: 'list_users',
    description: 'List users (admin only)',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  update_user_role: {
    name: 'update_user_role',
    description: 'Update a user role (mutating)',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'number' },
        role: { type: 'string', enum: ['administrator', 'moderator', 'viewer', 'guest'] },
      },
      required: ['user_id', 'role'],
    },
  },
  list_config: {
    name: 'list_config',
    description: 'List configuration entries',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  update_config: {
    name: 'update_config',
    description: 'Update a configuration entry (mutating)',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: {},
      },
      required: ['key', 'value'],
    },
  },
  agent_command_run: {
    name: 'agent_command_run',
    description: 'Run a command on an agent machine (future; currently not enabled)',
    parameters: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        command: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['agent_id', 'command', 'reason'],
    },
  },
} satisfies Record<ToolName, any>

export function toOpenAITools(names: ToolName[]) {
  return names.map((n) => ({
    type: 'function' as const,
    function: toolDefinitions[n],
  }))
}
