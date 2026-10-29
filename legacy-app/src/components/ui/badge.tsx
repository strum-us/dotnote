import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

export type BadgeColor =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'indigo'
  | 'purple'
  | 'gray'
  | 'pink'
  | 'primary'
  | 'secondary'
  | 'third'
  | 'destructive'
  | 'muted'
  | 'accent'
  | 'outline'
  | 'default';

const badgeVariants = cva(
  'inline-flex items-center rounded-sm border font-medium uppercase tracking-wide focus:outline-none focus:ring-1 focus:ring-accent-color/30 select-none cursor-default',
  {
    variants: {
      variant: {
        default: 'border-divider bg-raised text-muted-foreground',
        secondary: 'border-divider bg-secondary text-secondary-foreground',
        third: 'border-divider bg-third text-third-foreground',
        primary: 'border-accent-hover bg-accent-color text-white',
        destructive: 'border-danger/50 bg-danger/15 text-danger',
        muted: 'border-divider bg-muted text-muted-foreground',
        accent: 'border-divider bg-accent text-accent-foreground',
        red: 'border-red-300/50 bg-red-950/30 text-red-300',
        orange: 'border-orange-300/50 bg-orange-950/30 text-orange-300',
        yellow: 'border-yellow-300/50 bg-yellow-950/30 text-yellow-300',
        green: 'border-green-300/50 bg-green-950/30 text-green-300',
        blue: 'border-blue-300/50 bg-blue-950/30 text-blue-300',
        indigo: 'border-indigo-300/50 bg-indigo-950/30 text-indigo-300',
        purple: 'border-purple-300/50 bg-purple-950/30 text-purple-300',
        gray: 'border-divider bg-muted text-muted-foreground',
        pink: 'border-pink-300/50 bg-pink-950/30 text-pink-300',
        outline: 'border-divider bg-transparent text-foreground',
      },
      size: {
        sm: 'px-1 py-0 text-micro font-mono normal-case tracking-normal',
        md: 'px-1.5 py-0.5 text-compact',
        lg: 'px-2 py-0.5 text-toolbar',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'sm',
    },
  }
);

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants>;

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
