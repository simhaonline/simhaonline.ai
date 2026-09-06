'use client';

// Minimal shadcn/ui-style primitives (dark zinc palette, violet primary).
// Hand-rolled to keep the dependency surface small while matching the
// shadcn component API used across the dashboard.

import * as React from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

// ── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline';
type ButtonSize = 'sm' | 'md' | 'icon';

const buttonVariants: Record<ButtonVariant, string> = {
  default: 'bg-violet-500 text-white hover:bg-violet-400',
  secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700',
  ghost: 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
  destructive: 'bg-red-500/90 text-white hover:bg-red-500',
  outline: 'border border-zinc-700 text-zinc-200 hover:bg-zinc-800',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  icon: 'h-8 w-8',
};

export function Button({
  className, variant = 'default', size = 'md', ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
        buttonVariants[variant],
        size !== 'md' ? buttonSizes[size] : '',
        className,
      )}
      {...props}
    />
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-zinc-800 bg-zinc-900', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-4 border-b border-zinc-800', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold text-zinc-100', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-zinc-500', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

// ── Badge ────────────────────────────────────────────────────────────────────

type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'outline' | 'violet';

const badgeTones: Record<BadgeTone, string> = {
  default: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  success: 'bg-green-500/10 text-green-400 border-green-500/30',
  danger: 'bg-red-500/10 text-red-400 border-red-500/30',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  violet: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
  outline: 'bg-transparent text-zinc-400 border-zinc-700',
};

export function Badge({ className, tone = 'default', ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', badgeTones[tone], className)}
      {...props}
    />
  );
}

// ── Input / Select / Label ───────────────────────────────────────────────────

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 text-sm text-zinc-100 focus:ring-1 focus:ring-violet-500 [&>option]:bg-zinc-950',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-xs font-medium text-zinc-400', className)} {...props} />;
}

// ── Switch ───────────────────────────────────────────────────────────────────

export function Switch({
  checked, onCheckedChange, disabled, 'aria-label': ariaLabel,
}: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; 'aria-label'?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50',
        checked ? 'bg-violet-500' : 'bg-zinc-700',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

// ── Slider ───────────────────────────────────────────────────────────────────

export function Slider({
  value, min, max, step, onValueChange, 'aria-label': ariaLabel,
}: {
  value: number; min: number; max: number; step: number;
  onValueChange: (v: number) => void; 'aria-label'?: string;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onValueChange(Number(e.target.value))}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-violet-500"
    />
  );
}

// ── Dialog ───────────────────────────────────────────────────────────────────

export function Dialog({
  open, onClose, title, children, width = 'max-w-lg',
}: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 pt-[12vh]" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn('w-full rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl', width)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="text-zinc-500 hover:text-zinc-200 cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// ── Sheet (side drawer) ──────────────────────────────────────────────────────

export function Sheet({
  open, onClose, title, children, width = 'max-w-md',
}: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex justify-end" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <section className={cn('h-full w-full border-l border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col', width)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button onClick={onClose} aria-label="Close panel" className="text-zinc-500 hover:text-zinc-200 cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">{children}</div>
      </section>
    </div>
  );
}

// ── Table primitives ─────────────────────────────────────────────────────────

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-800">
      <table className={cn('w-full text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('sticky top-0 bg-zinc-900 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500 border-b border-zinc-800', className)} {...props} />;
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2.5 border-b border-zinc-800/60 text-zinc-300', className)} {...props} />;
}

// ── Progress bar ─────────────────────────────────────────────────────────────

export function Progress({ percent, tone = 'violet' }: { percent: number; tone?: 'violet' | 'amber' | 'red' }) {
  const colors = { violet: 'bg-violet-500', amber: 'bg-amber-400', red: 'bg-red-400' };
  const chosen = percent >= 90 ? 'red' : percent >= 70 ? 'amber' : tone;
  return (
    <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
      <div className={cn('h-full rounded-full transition-all', colors[chosen])} style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }} />
    </div>
  );
}