import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border text-xs font-medium select-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-1 focus-visible:ring-accent-color/40 aria-invalid:border-danger aria-invalid:ring-danger/20",
  {
    variants: {
      variant: {
        default:
          'border-accent-hover bg-accent-color text-white hover:bg-accent-hover active:bg-accent-selected',
        destructive:
          'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 active:bg-danger/25',
        outline:
          'border-divider bg-transparent text-ink hover:bg-raised active:bg-raised-active',
        secondary:
          'border-divider bg-well text-ink-secondary hover:bg-raised hover:text-ink active:bg-raised-active',
        ghost:
          'border-transparent bg-transparent text-muted-foreground hover:bg-raised hover:text-ink active:bg-raised-active',
        link: 'border-transparent text-accent-color underline-offset-4 hover:underline',
        tool: 'border-divider bg-raised text-ink-secondary hover:bg-raised-hover hover:text-ink active:bg-raised-active data-[state=on]:bg-raised-active data-[state=on]:text-ink',
        sunken: 'border-divider bg-well text-ink hover:bg-well active:bg-raised-active',
      },
      size: {
        default: 'h-7 px-2.5 has-[>svg]:px-2',
        sm: 'h-6 px-2 text-[11px] has-[>svg]:px-1.5',
        lg: 'h-8 px-3 text-sm has-[>svg]:px-2.5',
        icon: 'h-7 w-7',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
