import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "success"
  | "link";
type Size = "xs" | "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-on-primary shadow-xs hover:bg-primary-hover active:bg-primary-active disabled:bg-accent-300",
  secondary:
    "bg-surface text-content border border-line-strong shadow-xs hover:bg-surface-hover active:bg-surface-active",
  ghost: "text-content-secondary hover:bg-surface-hover hover:text-content",
  danger:
    "bg-danger-600 text-white shadow-xs hover:bg-danger-700 active:bg-danger-700",
  success:
    "bg-success-600 text-white shadow-xs hover:bg-success-700 active:bg-success-700",
  link: "text-content-accent underline-offset-4 hover:underline p-0 h-auto",
};

const SIZES: Record<Size, string> = {
  xs: "h-7 px-2.5 text-xs gap-1.5 rounded-sm",
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-sm gap-2 rounded-md",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-lg",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  /**
   * Render the single child element instead of a `<button>`, keeping the
   * button's styling.
   *
   * This exists because a link that looks like a button must still *be* a link:
   * it has to open in a new tab on middle-click, show its target on hover, and
   * be announced as a link. Wrapping a `<Link>` in a real `<button>` produces
   * nested interactive elements, which is invalid markup and confuses screen
   * readers. `loading` is ignored here — a link cannot be pending.
   */
  asChild?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth,
      disabled,
      asChild = false,
      children,
      ...props
    },
    ref,
  ) {
    const classes = cn(
      "inline-flex items-center justify-center font-medium whitespace-nowrap",
      "transition-colors duration-[var(--lr-duration-fast)]",
      "disabled:cursor-not-allowed disabled:opacity-60",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
      VARIANTS[variant],
      variant !== "link" && SIZES[size],
      fullWidth && "w-full",
      className,
    );

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ className?: string }>;
      return React.cloneElement(child, {
        className: cn(classes, child.props.className),
      });
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={classes}
        {...props}
      >
        {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /** Required: icon-only controls must still be announced. */
  label: string;
};

const ICON_SIZES: Record<Size, string> = {
  xs: "size-7 rounded-sm",
  sm: "size-8 rounded-md",
  md: "size-9 rounded-md",
  lg: "size-11 rounded-lg",
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { className, variant = "ghost", size = "md", label, children, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex items-center justify-center",
          "transition-colors duration-[var(--lr-duration-fast)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
          VARIANTS[variant],
          ICON_SIZES[size],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
