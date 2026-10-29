import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { inputBase } from '@/lib/classNames';

const textareaVariants = cva(inputBase, {
  variants: {
    variant: {
      default: 'min-h-[64px] resize-y py-1.5',
      contact:
        'border-transparent shadow-none transition-all hover:border-divider hover:bg-well focus:bg-well focus:border-divider min-h-0 h-auto resize-none select-none cursor-default',
      dataSheetEditor:
        'px-[7px] py-[3px] border-transparent resize-none focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none h-auto resize-none overflow-auto border-none min-h-[64px] shadow-none',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> &
  VariantProps<typeof textareaVariants> & {
    isAutoGrow?: boolean;
    maxHeight?: string | number;
  };

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant, isAutoGrow, maxHeight, ...props }, ref) => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

    const combinedRef = (node: HTMLTextAreaElement) => {
      textareaRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    };

    const adjustHeight = React.useCallback(() => {
      if (isAutoGrow && textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        const newHeight = textareaRef.current.scrollHeight;

        if (maxHeight !== undefined) {
          const maxHeightValue = typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight;
          textareaRef.current.style.maxHeight = maxHeightValue;
          textareaRef.current.style.overflowY =
            newHeight > parseInt(maxHeightValue) ? 'auto' : 'hidden';
        }

        textareaRef.current.style.height = `${newHeight}px`;
      }
    }, [isAutoGrow, maxHeight]);

    React.useEffect(() => {
      if (isAutoGrow) {
        setTimeout(adjustHeight, 0);
      }
    }, [props.value, isAutoGrow, adjustHeight]);

    const handleInput = React.useCallback(() => {
      if (isAutoGrow) {
        adjustHeight();
      }
    }, [isAutoGrow, adjustHeight]);

    const style: React.CSSProperties = {
      ...(props.style || {}),
      ...(isAutoGrow
        ? {
            overflow: maxHeight !== undefined ? 'auto' : 'hidden',
            resize: 'none',
            ...(maxHeight !== undefined && {
              maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
            }),
          }
        : {}),
    };

    return (
      <textarea
        className={cn(textareaVariants({ variant }), className)}
        ref={combinedRef}
        onInput={handleInput}
        style={style}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea, textareaVariants };
