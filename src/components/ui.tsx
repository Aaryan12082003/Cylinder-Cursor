import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cloneElement, createContext, forwardRef, isValidElement, useContext, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const ButtonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-white hover:bg-primary-hover',
        secondary: 'border border-border bg-surface text-foreground hover:bg-background',
        ghost: 'text-muted hover:bg-background hover:text-foreground',
        danger: 'bg-danger text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-2.5',
        md: 'h-9 px-3.5',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof ButtonVariants> & { asChild?: boolean }>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp ref={ref} className={cn(ButtonVariants({ variant, size }), className)} {...props} />
  },
)
Button.displayName = 'Button'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/15',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'min-h-24 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/15',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export function Label({ children, className, htmlFor }: { children: ReactNode; className?: string; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className={cn('mb-1.5 block text-[13px] font-medium text-foreground', className)}>{children}</label>
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  const generatedId = useId()
  const control = isValidElement(children) ? children as ReactElement<{ id?: string }> : null
  const id = control?.props.id || generatedId
  return (
    <div>
      <Label htmlFor={control ? id : undefined}>{label}</Label>
      {control ? cloneElement(control, { id }) : children}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  )
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15',
        props.className,
      )}
    />
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-xl border border-border bg-surface shadow-card', className)}>{children}</section>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }) {
  const tones = {
    neutral: 'bg-background text-muted',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-600',
    info: 'bg-primary-soft text-primary',
  }
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-slate-100', className)} />
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-primary-soft text-primary">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <motion.div
      className="mx-auto max-w-[1440px] px-6 py-6 lg:px-8"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </motion.div>
  )
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[13px] text-muted">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}

const DialogContext = createContext<{ open: boolean }>({ open: false })

export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <DialogContext.Provider value={{ open }}>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        {children}
      </DialogPrimitive.Root>
    </DialogContext.Provider>
  )
}

export function DialogContent({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-border bg-surface p-6 shadow-card',
          className,
        )}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description> : null}
          </div>
          <DialogPrimitive.Close className="rounded-lg p-1 text-muted hover:bg-background">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function Sheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-900/20" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-border bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-lg p-1 text-muted hover:bg-background">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-auto px-5 py-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function Menu({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>{trigger}</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content className="z-50 min-w-44 rounded-xl border border-border bg-surface p-1 shadow-card" align="end">
          {children}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}

export function MenuItem({ children, onSelect, danger = false }: { children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      onSelect={onSelect}
      className={cn('cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-background', danger && 'text-danger')}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  )
}

export function Switch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="relative h-6 w-10 rounded-full bg-slate-200 data-[state=checked]:bg-primary"
    >
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  )
}

export function Tabs({ value, onChange, tabs, children }: { value: string; onChange: (value: string) => void; tabs: { id: string; label: string }[]; children: ReactNode }) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onChange}>
      <TabsPrimitive.List className="mb-4 flex gap-1 rounded-xl bg-background p-1">
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.id}
            value={tab.id}
            className="rounded-lg px-3 py-1.5 text-sm text-muted data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-card"
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  )
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return <TabsPrimitive.Content value={value}>{children}</TabsPrimitive.Content>
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  disabled,
  onConfirm,
  onOpenChange,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  disabled?: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={body} className="max-w-md">
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={disabled}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function useDialogOpen() {
  return useContext(DialogContext).open
}
