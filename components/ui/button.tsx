import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "quiet" | "danger";

const styles: Record<Variant, string> = {
  // Pills are reserved for primary actions (§7 radius rules).
  primary:
    "rounded-full bg-ink text-chalk font-semibold px-6 py-3 border border-ink " +
    "hover:bg-ink/85 active:translate-x-px active:translate-y-px disabled:opacity-40 disabled:pointer-events-none",
  secondary:
    "rounded-(--radius-ctl) bg-chalk text-ink font-semibold px-4 py-2 border border-ink " +
    "shadow-(--shadow-plane-sm) hover:bg-paper active:translate-x-px active:translate-y-px active:shadow-none disabled:opacity-40 disabled:pointer-events-none",
  quiet:
    "rounded-(--radius-ctl) text-ink font-semibold px-3 py-2 underline decoration-slate underline-offset-4 " +
    "hover:decoration-ink disabled:opacity-40 disabled:pointer-events-none",
  danger:
    "rounded-(--radius-ctl) bg-chalk text-flag font-semibold px-4 py-2 border border-flag " +
    "hover:bg-flag/10 disabled:opacity-40 disabled:pointer-events-none",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "primary", className = "", ...props }, ref) {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-2 text-sm transition-colors cursor-pointer ${styles[variant]} ${className}`}
        {...props}
      />
    );
  },
);
