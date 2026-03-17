import { useQuery } from "@tanstack/react-query";

export interface ComputedChecklistItem {
  id: string;
  question: string;
  category: string;
  fieldMapping?: string;
  isCompleted: boolean;
  isManuallyCompleted: boolean;
}

export interface ComputedChecklist {
  items: ComputedChecklistItem[];
  completedCount: number;
  totalItems: number;
  completedPercentage: number;
  templateName?: string;
}

/**
 * Fetches the computed checklist for a case.
 * Polls every 5 seconds while actively recording so completed ticks appear in real time.
 *
 * @param selectedCaseId - the case ID string (empty string = disabled)
 * @param enabled        - true when the checklist panel is visible (recording or review mode)
 * @param isRecording    - true only during active recording (enables 5s polling)
 */
export function useComputedChecklist(
  selectedCaseId: string,
  enabled: boolean,
  isRecording: boolean,
) {
  return useQuery<ComputedChecklist | null>({
    queryKey: ["/api/cases", selectedCaseId, "checklist"],
    queryFn: async () => {
      if (!selectedCaseId) return null;
      const res = await fetch(`/api/cases/${selectedCaseId}/checklist`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedCaseId && enabled,
    refetchInterval: isRecording ? 5000 : false,
  });
}
