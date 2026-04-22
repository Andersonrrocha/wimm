import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant = "primary" | "ghost" | "subtle" | "danger";
export type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Makes the button fill its container width. */
  block?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-sm border border-transparent " +
  "font-medium transition duration-wm-fast ease-wm " +
  "active:translate-y-px " +
  "disabled:opacity-50 disabled:cursor-not-allowed " +
  "aria-disabled:opacity-50 aria-disabled:cursor-not-allowed " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-accent";

const sizes: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-wm-xs",
  md: "px-3.5 py-2 text-wm-sm",
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-[#faf9f7] shadow-wm-soft hover:bg-accent-hover hover:text-white",
  ghost:
    "bg-surface-1 text-[#f2f2f7] border-line hover:bg-surface-2 hover:border-line-strong hover:text-white",
  subtle:
    "bg-transparent text-[#d4d5de] hover:bg-surface-2 hover:text-[#f5f5fa]",
  danger:
    "bg-transparent text-[#ffb3b3] border-[rgba(255,160,160,0.45)] hover:bg-negative-soft hover:text-[#ffd6d6]",
};

/**
 * Primary action button used across the app.
 *
 * Use `size="sm"` for dense toolbars and filter rows; default `md` for
 * primary actions.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "ghost",
      size = "md",
      block,
      className,
      type = "button",
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          base,
          sizes[size],
          variants[variant],
          block && "w-full",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
