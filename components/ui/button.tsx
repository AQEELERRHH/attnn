import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold tracking-[-0.005em] transition-[background-color,border-color,color,filter,transform,box-shadow,opacity] duration-200 ease-smooth active:scale-[0.97] active:duration-75 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arc-lavender/80 focus-visible:ring-offset-2 focus-visible:ring-offset-arc-bg-0 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Solid signal orange with dark text: the market's primary action (bid, collect).
        default:
          "bg-arc-gold text-on-accent shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_1px_2px_0_rgb(0_0_0/0.4)] hover:brightness-110 hover:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_6px_20px_-8px_rgb(var(--signal)/0.6)] disabled:bg-arc-bg-3 disabled:text-text-secondary disabled:opacity-100 disabled:shadow-none",
        // Tinted orange for actions repeated down a list; fills on hover, or when its row (.group) is hovered.
        soft: "border border-arc-gold/35 bg-arc-gold/[0.07] text-arc-gold hover:border-arc-gold hover:bg-arc-gold hover:text-on-accent group-hover:enabled:border-arc-gold group-hover:enabled:bg-arc-gold group-hover:enabled:text-on-accent",
        destructive: "bg-arc-coral text-on-accent hover:brightness-110",
        outline: "border border-border-bright bg-arc-bg-1 text-text-primary hover:border-text-primary/25 hover:bg-arc-bg-2",
        secondary: "bg-arc-bg-3 text-text-primary hover:bg-arc-bg-2 hover:text-text-primary",
        ghost: "text-text-secondary hover:bg-arc-bg-2 hover:text-text-primary",
        link: "link-u h-auto px-0 text-arc-lavender",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 px-7 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={props.type ?? "button"}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
