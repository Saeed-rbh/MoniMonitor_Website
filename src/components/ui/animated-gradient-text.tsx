import { ReactNode } from "react";

import { cn } from "@/lib/utils";

export default function AnimatedGradientText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative mx-auto flex max-w-fit flex-row  transition-shadow duration-5000 ease-in-out [--bg-size:300%] ",
        className,
      )}
    >
      <div/>
      {children}
    </div>
  );
}
