// ============================================================
// Markdown Content — Assistant 文本 Markdown 渲染
// ============================================================

import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface MarkdownContentProps {
  children: string;
  className?: string;
}

const WRAP_CLASS = 'min-w-0 max-w-full';
const BLOCK_WRAP_CLASS = `${WRAP_CLASS} first:mt-0 last:mb-0`;

const markdownComponents: Components = {
  p({ className, node: _node, ...props }) {
    return <p className={cn(BLOCK_WRAP_CLASS, 'my-2 leading-6', className)} {...props} />;
  },
  h1({ className, node: _node, ...props }) {
    return (
      <h1
        className={cn(BLOCK_WRAP_CLASS, 'mt-3 mb-2 text-base leading-6 font-semibold', className)}
        {...props}
      />
    );
  },
  h2({ className, node: _node, ...props }) {
    return (
      <h2
        className={cn(BLOCK_WRAP_CLASS, 'mt-3 mb-2 text-[15px] leading-6 font-semibold', className)}
        {...props}
      />
    );
  },
  h3({ className, node: _node, ...props }) {
    return (
      <h3
        className={cn(BLOCK_WRAP_CLASS, 'mt-3 mb-1.5 text-sm leading-5 font-semibold', className)}
        {...props}
      />
    );
  },
  h4({ className, node: _node, ...props }) {
    return (
      <h4
        className={cn(BLOCK_WRAP_CLASS, 'mt-2.5 mb-1.5 text-sm leading-5 font-medium', className)}
        {...props}
      />
    );
  },
  h5({ className, node: _node, ...props }) {
    return (
      <h5
        className={cn(
          BLOCK_WRAP_CLASS,
          'mt-2.5 mb-1.5 text-[13px] leading-5 font-medium',
          className,
        )}
        {...props}
      />
    );
  },
  h6({ className, node: _node, ...props }) {
    return (
      <h6
        className={cn(
          BLOCK_WRAP_CLASS,
          'text-muted-foreground mt-2.5 mb-1.5 text-[13px] leading-5 font-medium',
          className,
        )}
        {...props}
      />
    );
  },
  ul({ className, node: _node, ...props }) {
    return (
      <ul className={cn(BLOCK_WRAP_CLASS, 'my-2 list-disc space-y-1 pl-5', className)} {...props} />
    );
  },
  ol({ className, node: _node, ...props }) {
    return (
      <ol
        className={cn(BLOCK_WRAP_CLASS, 'my-2 list-decimal space-y-1 pl-5', className)}
        {...props}
      />
    );
  },
  li({ className, node: _node, ...props }) {
    return <li className={cn(WRAP_CLASS, 'pl-1', className)} {...props} />;
  },
  blockquote({ className, node: _node, ...props }) {
    return (
      <blockquote
        className={cn(
          BLOCK_WRAP_CLASS,
          'border-border/80 text-muted-foreground my-2 border-l pl-3',
          className,
        )}
        {...props}
      />
    );
  },
  a({ className, node: _node, ...props }) {
    return (
      <a
        className={cn(
          WRAP_CLASS,
          'text-foreground decoration-muted-foreground/50 hover:decoration-foreground underline underline-offset-2',
          className,
        )}
        rel="noreferrer"
        target="_blank"
        {...props}
      />
    );
  },
  code({ className, node: _node, ...props }) {
    return (
      <code
        className={cn(
          WRAP_CLASS,
          'bg-muted/45 rounded px-1 py-0.5 font-mono text-[0.9em]',
          className,
        )}
        {...props}
      />
    );
  },
  pre({ className, node: _node, ...props }) {
    return (
      <ScrollArea
        className="scout-markdown-code-scroll border-border/70 bg-muted/25 my-2 w-full max-w-full min-w-0 rounded-md border first:mt-0 last:mb-0"
        data-scout-markdown-code-scroll="true"
        scrollbars="horizontal"
        type="always"
        viewportClassName="overflow-x-auto overflow-y-hidden"
      >
        <pre
          className={cn(
            'w-max max-w-none min-w-full px-3 py-2 font-mono text-[12px] leading-5 whitespace-pre [&_code]:break-normal [&_code]:[overflow-wrap:normal] [&_code]:whitespace-pre',
            className,
          )}
          {...props}
        />
      </ScrollArea>
    );
  },
  table({ className, node: _node, ...props }) {
    return (
      <div
        className="scout-markdown-table-wrapper my-2 w-full max-w-full min-w-0 overflow-hidden first:mt-0 last:mb-0"
        data-scout-markdown-table-wrapper="true"
      >
        <table
          className={cn(
            'scout-markdown-table border-border/70 w-full table-fixed border-collapse text-left text-[12px]',
            className,
          )}
          {...props}
        />
      </div>
    );
  },
  th({ className, node: _node, ...props }) {
    return (
      <th
        className={cn(
          WRAP_CLASS,
          'scout-markdown-table-cell border-border/70 bg-muted/35 border px-2 py-1 align-top font-medium',
          className,
        )}
        {...props}
      />
    );
  },
  td({ className, node: _node, ...props }) {
    return (
      <td
        className={cn(
          WRAP_CLASS,
          'scout-markdown-table-cell border-border/70 border px-2 py-1 align-top',
          className,
        )}
        {...props}
      />
    );
  },
  hr({ className, node: _node, ...props }) {
    return <hr className={cn('border-border/70 my-3 max-w-full min-w-0', className)} {...props} />;
  },
  input({ className, node: _node, ...props }) {
    return (
      <input
        className={cn('accent-foreground mr-1.5 align-middle', className)}
        disabled
        {...props}
      />
    );
  },
};

function MarkdownContentView({ children, className }: MarkdownContentProps) {
  return (
    <div
      className={cn('scout-markdown-content w-full max-w-full min-w-0', className)}
      data-scout-markdown-content="true"
    >
      <Markdown components={markdownComponents} remarkPlugins={[remarkGfm]} skipHtml>
        {children}
      </Markdown>
    </div>
  );
}

// Markdown 解析和代码块/表格组件树较重；同样文本重复进入 render 时直接复用上一轮输出。
export const MarkdownContent = memo(
  MarkdownContentView,
  (previous, next) => previous.children === next.children && previous.className === next.className,
);
