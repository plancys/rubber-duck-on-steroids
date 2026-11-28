import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  known: boolean;
  className?: string;
}

/**
 * The box of a "known" toggle: empty without a mark, filled with a check for the mark "known".
 * The toggle gives its state with aria-pressed, so a screen reader skips the box.
 */
export default function KnownBox({ known, className }: Props) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 flex-none items-center justify-center rounded-sm border-2",
        known ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground bg-background",
        className,
      )}
    >
      {known && <Check className="size-3.5" strokeWidth={3} />}
    </span>
  );
}
