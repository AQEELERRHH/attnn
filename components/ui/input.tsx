import * as React from "react";
import { cn } from "@/lib/cn";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-border-bright bg-arc-bg-0 px-3 py-2 text-sm text-text-primary placeholder:text-text-dim transition-colors hover:border-text-primary/20 focus:border-arc-lavender/60 focus:outline-none focus:ring-2 focus:ring-arc-lavender/20 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
