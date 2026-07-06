// ============================================================
// Slash Command Options — 命令候选纯数据推导
// ============================================================

import {
  FileText,
  GitBranch,
  Lollipop,
  Plug,
  Sparkles,
  Split,
  type LucideIcon,
} from 'lucide-react';
import type { ScoutCommandInfo } from '@scout-agent/shared';

// ---------- 类型 ----------

export type SlashBuiltinAction = 'tree' | 'compact' | 'fork';

export interface SlashCommandMenuItem {
  type: 'command';
  key: string;
  command: ScoutCommandInfo;
  icon: LucideIcon;
  label: string;
  description: string;
  builtinAction?: SlashBuiltinAction;
}

// ---------- 候选 ----------

export function buildSlashCommandItems(options: {
  allowExtensionCommands?: boolean;
  allowForkCommand?: boolean;
  commands: ScoutCommandInfo[];
  query: string;
}): SlashCommandMenuItem[] {
  const allowExtensionCommands = options.allowExtensionCommands ?? true;
  const allowForkCommand = options.allowForkCommand ?? true;
  const query = options.query.trim().toLowerCase();
  const commandItems = options.commands
    .filter((command) => allowExtensionCommands || command.source !== 'extension')
    .map((command) => toSlashCommandItem(command, { allowForkCommand }))
    .filter((item): item is SlashCommandMenuItem => item !== null);

  if (!query) return commandItems;

  return commandItems.filter((item) => {
    const commandName = item.type === 'command' ? item.command.name : item.label;
    return (
      commandName.toLowerCase().includes(query) ||
      item.label.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)
    );
  });
}

function toSlashCommandItem(
  command: ScoutCommandInfo,
  options: { allowForkCommand: boolean },
): SlashCommandMenuItem | null {
  if (command.source === 'builtin') {
    return toBuiltinCommandItem(command, options);
  }

  const iconBySource: Record<Exclude<ScoutCommandInfo['source'], 'builtin'>, LucideIcon> = {
    extension: Plug,
    prompt: FileText,
    skill: Sparkles,
  };

  return {
    type: 'command',
    key: `${command.source}:${command.name}`,
    command,
    icon: iconBySource[command.source],
    label: command.name,
    description: command.description ?? getSourceDescription(command.source),
  };
}

function toBuiltinCommandItem(
  command: ScoutCommandInfo,
  options: { allowForkCommand: boolean },
): SlashCommandMenuItem | null {
  const action = getSupportedBuiltinAction(command.name);
  if (!action) return null;
  if (action === 'fork' && !options.allowForkCommand) return null;
  const meta = BUILTIN_META[action];

  return {
    type: 'command',
    key: `builtin:${command.name}`,
    command,
    builtinAction: action,
    icon: meta.icon,
    label: meta.label,
    description: meta.description,
  };
}

function getSupportedBuiltinAction(name: string): SlashBuiltinAction | undefined {
  if (name === 'tree' || name === 'compact' || name === 'fork') {
    return name;
  }
  return undefined;
}

function getSourceDescription(source: ScoutCommandInfo['source']): string {
  switch (source) {
    case 'extension':
      return '扩展命令';
    case 'prompt':
      return '提示词模板';
    case 'skill':
      return '技能';
    case 'builtin':
      return '内置命令';
  }
}

const BUILTIN_META: Record<
  SlashBuiltinAction,
  {
    icon: LucideIcon;
    label: string;
    description: string;
  }
> = {
  tree: {
    icon: GitBranch,
    label: '会话树',
    description: '查看会话树',
  },
  compact: {
    icon: Lollipop,
    label: '压缩',
    description: '压缩当前会话',
  },
  fork: {
    icon: Split,
    label: '分叉',
    description: '从历史消息创建分支',
  },
};
