// ============================================================
// Nested Scroll Boundary — 内层滚动协议
// ============================================================
/* eslint-disable react-refresh/only-export-components -- 组件和 props helper 共享同一个 DOM 协议入口。 */

import type { ComponentProps } from 'react';

export type NestedScrollBoundaryAxis = 'vertical' | 'horizontal' | 'both';

interface NestedScrollBoundaryProps extends ComponentProps<'div'> {
  axis?: NestedScrollBoundaryAxis;
}

export function getNestedScrollBoundaryProps(axis: NestedScrollBoundaryAxis = 'vertical') {
  return { 'data-scout-nested-scroll': axis } as const;
}

export function NestedScrollBoundary({ axis = 'vertical', ...props }: NestedScrollBoundaryProps) {
  return <div {...getNestedScrollBoundaryProps(axis)} {...props} />;
}
