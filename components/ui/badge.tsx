import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "bg-arc-purple/20 text-arc-lavender border border-arc-purple/30",
        secondary: "bg-arc-bg-2 text-text-secondary border border-border-bright",
        destructive: "bg-arc-coral/20 text-arc-coral border border-arc-coral/30",
        success: "bg-green/20 text-green border border-green/30",
        gold: "bg-arc-gold/20 text-arc-gold border border-arc-gold/30",
        outline: "text-text-primary border border-border-bright",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
