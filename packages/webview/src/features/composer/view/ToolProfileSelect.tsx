// ============================================================
// Tool Profile Select — 输入框工具模式选择
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Flame, ShieldCheck, Wrench } from 'lucide-react';
import { SCOUT_BUILTIN_TOOL_PROFILE_IDS } from '@scout-agent/shared';
import type { ScoutToolProfileDefinition } from '@scout-agent/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const COMPACT_GROUP_WIDTH_PX = 112;

interface ToolProfileSelectProps {
  profileId: string;
  profiles: ReadonlyArray<
    ScoutToolProfileDefinition & { readonly unavailableTools?: readonly string[] }
  >;
  onValueChange: (profileId: string) => void;
}

export function ToolProfileSelect({ profileId, profiles, onValueChange }: ToolProfileSelectProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [compact, setCompact] = useState(false);
  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? profiles[0];

  useEffect(() => {
    const target = triggerRef.current?.parentElement;
    if (!target || typeof ResizeObserver === 'undefined') return undefined;

    const updateCompact = () => {
      setCompact(target.getBoundingClientRect().width < COMPACT_GROUP_WIDTH_PX);
    };
    updateCompact();
    const observer = new ResizeObserver(updateCompact);
    observer.observe(target);
    return () => observer.disconnect();
  }, [selectedProfile?.id]);

  if (!selectedProfile) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          aria-label="工具模式"
          title={selectedProfile.name}
          className={cn(
            'text-muted-foreground max-w-36 min-w-0 shrink rounded-full',
            compact && 'w-7 px-0',
          )}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ToolProfileIcon
            profileId={selectedProfile.id}
            data-icon={compact ? undefined : 'inline-start'}
            className="size-3.5 shrink-0"
          />
          {compact ? null : <span className="min-w-0 truncate">{selectedProfile.name}</span>}
          {compact ? null : <ChevronDown data-icon="inline-end" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="bg-background text-foreground w-42 rounded-lg p-1 shadow-sm"
      >
        <DropdownMenuRadioGroup value={selectedProfile.id} onValueChange={onValueChange}>
          {profiles.map((profile) => {
            return (
              <DropdownMenuRadioItem
                key={profile.id}
                value={profile.id}
                className="min-h-7 pr-8 pl-1.5 text-xs"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ToolProfileIcon
                    profileId={profile.id}
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{profile.name}</span>
                    {profile.unavailableTools?.length ? (
                      <span className="text-muted-foreground truncate text-xs">部分工具不可用</span>
                    ) : null}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ToolProfileIcon({
  profileId,
  className,
  ...props
}: {
  profileId: string;
  className?: string;
  'data-icon'?: string;
}) {
  if (profileId === SCOUT_BUILTIN_TOOL_PROFILE_IDS[0]) {
    return <Flame className={className} {...props} />;
  }
  if (profileId === SCOUT_BUILTIN_TOOL_PROFILE_IDS[1]) {
    return <ShieldCheck className={className} {...props} />;
  }
  return <Wrench className={className} {...props} />;
}
