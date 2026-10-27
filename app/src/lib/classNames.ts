export const navItemClass = (active: boolean) =>
  active
    ? 'bg-accent-color/12 font-semibold text-accent-color'
    : 'text-muted-foreground hover:bg-raised-hover hover:text-ink';

export const navBtnBase =
  'pro-layer-row rounded-sm outline-none';

export const iconBtnBase =
  'inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 outline-none';

export const inputBase =
  'w-full rounded-sm border border-divider bg-well px-2.5 py-1.5 text-xs text-ink placeholder:text-dim outline-none focus:border-accent-color focus:bg-panel focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50';

export const panelHeaderClass = 'pro-panel-header h-9 px-3';

export const dockAsideClass =
  'flex h-full shrink-0 flex-col overflow-hidden border-r border-divider bg-sidebar';

export const optionsBarClass =
  'flex shrink-0 items-center gap-1 border-b border-divider bg-panel-header px-2 py-1.5';
