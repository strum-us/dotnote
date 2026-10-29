import * as React from 'react';

import { type VariantProps, cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { inputBase } from '@/lib/classNames';

const inputVariants = cva(inputBase, {
  variants: {
    variant: {
      default: '',
      contact:
        'border-transparent hover:border-divider hover:bg-well focus:border-divider',
      borderless:
        'border-0 bg-transparent focus:bg-transparent focus:border-0 rounded-none',
    },
    size: {
      default: 'h-7',
      xs: 'h-6 px-2 text-[11px]',
      sm: 'h-7 px-2',
      lg: 'h-8 px-3 text-sm',
      icon: 'h-7 w-7 px-0 text-center',
      wide: 'h-7 w-full',
    },
    hasLeftIcon: {
      true: 'pl-8',
      false: '',
    },
    hasRightIcon: {
      true: 'pr-8',
      false: '',
    },
  },
  defaultVariants: {
    size: 'default',
    hasLeftIcon: false,
    hasRightIcon: false,
    variant: 'default',
  },
});

export type InputProps = {
  variant?: 'default' | 'contact' | 'borderless';
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'wide';
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> &
  VariantProps<typeof inputVariants>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size, type, leftIcon, rightIcon, variant, ...props }, ref) => {
    return (
      <div className="relative">
        {leftIcon && (
          <div className="absolute text-dim -translate-y-1/2 left-2.5 top-1/2">{leftIcon}</div>
        )}
        {rightIcon && (
          <div className="absolute -translate-y-1/2 right-2.5 top-1/2">{rightIcon}</div>
        )}
        <input
          onKeyDown={e => {
            if (e.key === 's' && e.metaKey) {
              e.preventDefault();
            }
          }}
          type={type}
          className={cn(
            'disabled:cursor-not-allowed disabled:opacity-50',
            inputVariants({
              size,
              variant,
              hasLeftIcon: !!leftIcon,
              hasRightIcon: !!rightIcon,
            }),
            className
          )}
          ref={ref}
          {...props}
        />
      </div>
    );
  }
);
Input.displayName = 'Input';

export { Input, inputVariants };
