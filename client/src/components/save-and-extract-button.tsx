import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";

interface SaveAndExtractButtonProps {
  /**
   * Optional async step that runs before extraction (e.g. PATCH transcript to server).
   * If omitted, the button skips straight to onExtract.
   * If the transcript hasn't changed you can still pass this — just return early inside it.
   */
  onSave?: () => Promise<void>;
  /** Trigger the reprocess/extract mutation. Called after onSave resolves. */
  onExtract: () => void;
  /** True while the extraction mutation is pending. */
  isExtracting: boolean;
  disabled?: boolean;
  label?: string;
  extractingLabel?: string;
  savingLabel?: string;
  size?: "sm" | "default" | "lg";
  variant?: "outline" | "default" | "ghost";
  className?: string;
  "data-testid"?: string;
}

/**
 * Button that optionally saves a transcript (PATCH) before running AI extraction.
 * Manages its own saving state so the button is disabled and spinning from the first
 * click through to the end of extraction — preventing concurrent calls.
 */
export function SaveAndExtractButton({
  onSave,
  onExtract,
  isExtracting,
  disabled = false,
  label = "Save & Extract",
  extractingLabel = "Extracting...",
  savingLabel = "Saving...",
  size = "sm",
  variant = "outline",
  className,
  "data-testid": testId,
}: SaveAndExtractButtonProps) {
  const [isSaving, setIsSaving] = useState(false);

  const isPending = isSaving || isExtracting;

  const handleClick = async () => {
    if (isPending || disabled) return;
    if (onSave) {
      setIsSaving(true);
      try {
        await onSave();
      } catch (e) {
        console.error("[SaveAndExtractButton] save step failed:", e);
      } finally {
        setIsSaving(false);
      }
    }
    onExtract();
  };

  return (
    <Button
      size={size}
      variant={variant}
      onClick={handleClick}
      disabled={isPending || disabled}
      className={className}
      data-testid={testId}
    >
      {isPending ? (
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
      ) : (
        <CheckCircle2 className="w-4 h-4 mr-2" />
      )}
      {isSaving ? savingLabel : isExtracting ? extractingLabel : label}
    </Button>
  );
}
