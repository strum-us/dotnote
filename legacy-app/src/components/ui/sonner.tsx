
import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { Toaster as Sonner } from 'sonner';

import { themeStore } from '@/stores/theme-store';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = observer(function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme={themeStore.resolved}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
});

export { Toaster };
