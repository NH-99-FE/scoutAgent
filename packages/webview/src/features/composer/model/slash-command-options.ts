// ============================================================
// Slash Command Options — 命令候选纯数据推导
// ============================================================

import { Box, FileText, GitBranch, Lollipop, Plug, Split, type LucideIcon } from 'lucide-react';
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
  allowSessionCommands?: boolean;
  commands: ScoutCommandInfo[];
  query: string;
}): SlashCommandMenuItem[] {
  const allowExtensionCommands = options.allowExtensionCommands ?? true;
  const allowSessionCommands = options.allowSessionCommands ?? true;
  const query = options.query.trim().toLowerCase();
  const commandItems = options.commands
    .filter((command) => allowExtensionCommands || command.source !== 'extension')
    .map((command) => toSlashCommandItem(command, { allowSessionCommands }))
    .filter((item): item is SlashCommandMenuItem => item !== null);

  if (!query) return orderSlashCommandItems(commandItems);

  return orderSlashCommandItems(
    commandItems.filter((item) => {
      const commandName = item.type === 'command' ? item.command.name : item.label;
      return (
        commandName.toLowerCase().includes(query) ||
        item.label.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query)
      );
    }),
  );
}

function orderSlashCommandItems(items: SlashCommandMenuItem[]): SlashCommandMenuItem[] {
  const skillItems = items.filter((item) => item.command.source === 'skill');
  if (skillItems.length === 0) return items;
  const primaryItems = items.filter((item) => item.command.source !== 'skill');
  return [...primaryItems, ...skillItems];
}

function toSlashCommandItem(
  command: ScoutCommandInfo,
  options: { allowSessionCommands: boolean },
): SlashCommandMenuItem | null {
  if (command.source === 'builtin') {
    return toBuiltinCommandItem(command, options);
  }

  const iconBySource: Record<Exclude<ScoutCommandInfo['source'], 'builtin'>, LucideIcon> = {
    extension: Plug,
    prompt: FileText,
    skill: Box,
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
  options: { allowSessionCommands: boolean },
): SlashCommandMenuItem | null {
  const action = getSupportedBuiltinAction(command.name);
  if (!action) return null;
  if (isSessionBoundBuiltinAction(action) && !options.allowSessionCommands) return null;
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

function isSessionBoundBuiltinAction(action: SlashBuiltinAction): boolean {
  return action === 'tree' || action === 'compact' || action === 'fork';
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
