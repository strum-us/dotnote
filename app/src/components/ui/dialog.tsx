
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';

import { VariantProps, cva } from 'class-variance-authority';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-[90] bg-black/55', className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const dialogVariants = cva(
  'fixed z-[90] flex flex-col gap-3.5 overflow-hidden rounded-sm border border-divider bg-panel p-4',
  {
    variants: {
      size: {
        default:
          'w-full max-w-[480px] max-h-[calc(100%-2rem)] left-[50%] top-[80px] translate-x-[-50%]',
        xs: 'w-full max-w-[320px] h-[240px] left-[50%] top-[80px] translate-x-[-50%]',
        sm: 'w-full max-w-[640px] h-[480px] left-[50%] top-[80px] translate-x-[-50%]',
        lg: 'w-full max-w-[1000px] w-[800px] h-[600px] left-[50%] top-[80px] translate-x-[-50%]',
        xl: 'w-full max-w-[1400px] w-[1200px] h-[980px] left-[50%] top-[80px] translate-x-[-50%]',
        full: 'w-[calc(100%-4rem)] h-[85vh] left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%]',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
    VariantProps<typeof dialogVariants> & {
      hideCloseButton?: boolean;
    }
>(({ className, children, size, hideCloseButton = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(dialogVariants({ size }), className)}
      {...props}
    >
      {children}
      {!hideCloseButton && (
        <DialogPrimitive.Close className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-sm border border-divider bg-raised text-muted-foreground hover:bg-raised-hover hover:text-ink focus:outline-none disabled:pointer-events-none">
          <X className="w-3.5 h-3.5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 pr-6 text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse border-t border-divider pt-3 sm:flex-row sm:justify-end sm:space-x-2',
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-sm font-semibold leading-none tracking-tight text-ink', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-xs leading-relaxed text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  dialogVariants,
};
