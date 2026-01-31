import { cn } from "@/lib/utils";

type Status = 
  | "active" | "closed" | "pending" 
  | "completed" | "missed" | "in-progress" 
  | "recording" | "processing" | "draft" | "final";

interface StatusBadgeProps {
  status: Status | string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const getStyles = (s: string) => {
    switch (s.toLowerCase()) {
      case "active":
      case "completed":
      case "final":
        return "bg-green-100 text-green-700 border-green-200";
      case "pending":
      case "processing":
      case "draft":
        return "bg-amber-100 text-amber-700 border-amber-200";
      case "closed":
      case "missed":
        return "bg-slate-100 text-slate-700 border-slate-200";
      case "in-progress":
      case "recording":
        return "bg-blue-100 text-blue-700 border-blue-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize shadow-sm",
        getStyles(status),
        className
      )}
    >
      {status}
    </span>
  );
}
