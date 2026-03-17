import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useComputedChecklist } from "@/hooks/use-computed-checklist";
import { SaveAndExtractButton } from "@/components/save-and-extract-button";
import { CATEGORY_CONFIG } from "@/constants/checklist-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  FileText,
  ClipboardList,
  ChevronRight,
} from "lucide-react";
import { Link } from "wouter";
import type { Call, Meeting, Case, IntakeData } from "@shared/schema";
import type { ReprocessResult } from "@shared/routes";

function isIntakeData(data: unknown): data is IntakeData {
  return typeof data === "object" && data !== null;
}

interface ChecklistItemWithStatus {
  id: string;
  question: string;
  category: string;
  fieldMapping?: string;
  isCompleted: boolean;
  isManuallyCompleted: boolean;
}

export default function CommunicationsReview() {
  const [, navigate] = useLocation();
  const { type, id } = useParams<{ type: string; id: string }>();
  const { toast } = useToast();

  const isCall = type === "call";
  const isMeeting = type === "meeting";

  // Fetch the call or meeting
  const { data: call, isLoading: callLoading } = useQuery<Call>({
    queryKey: ["/api/calls", id],
    queryFn: async () => {
      const res = await fetch(`/api/calls/${id}`);
      if (!res.ok) throw new Error("Failed to fetch call");
      return res.json();
    },
    enabled: isCall,
  });

  const { data: meeting, isLoading: meetingLoading } = useQuery<Meeting>({
    queryKey: ["/api/meetings", id],
    queryFn: async () => {
      const res = await fetch(`/api/meetings/${id}`);
      if (!res.ok) throw new Error("Failed to fetch meeting");
      return res.json();
    },
    enabled: isMeeting,
  });

  const item = isCall ? call : meeting;
  const isLoading = isCall ? callLoading : meetingLoading;

  const caseId = item?.caseId?.toString() || "";

  const [editableTranscript, setEditableTranscript] = useState("");

  // Initialise transcript once item loads
  useEffect(() => {
    if (item) {
      setEditableTranscript((item as any).transcript || "");
    }
  }, [item?.id]);

  const { data: selectedCase } = useQuery<Case>({
    queryKey: ["/api/cases/:id", caseId],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}`);
      if (!res.ok) throw new Error("Failed to fetch case");
      return res.json();
    },
    enabled: !!caseId,
  });

  const { data: checklist } = useComputedChecklist(caseId, !!caseId, false);

  const categoryConfig = CATEGORY_CONFIG;

  const groupedChecklist =
    checklist?.items?.reduce(
      (acc, item) => {
        const cat = item.category || "supplementary";
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(item);
        return acc;
      },
      {} as Record<string, ChecklistItemWithStatus[]>,
    ) || {};

  // ── Mutations ──

  const toggleChecklistMutation = useMutation({
    mutationFn: async (itemId: string) =>
      apiRequest("POST", `/api/cases/${caseId}/checklist/${itemId}/toggle`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "checklist"] });
    },
    onError: (error: any) => {
      toast({
        title: "Cannot toggle item",
        description: error?.message || "This item cannot be manually toggled",
        variant: "destructive",
      });
    },
  });

  const reprocessCallMutation = useMutation({
    mutationFn: () => apiRequest<ReprocessResult>("POST", `/api/calls/${id}/reprocess`, {}),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      if (data?.caseId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/cases/:id", data.caseId.toString()],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/cases", data.caseId.toString(), "checklist"],
        });
      }
      toast({ title: "Call Reprocessed", description: data?.message || "Intake data extracted." });
    },
    onError: (error: any) => {
      toast({
        title: "Reprocess Failed",
        description: error?.message || "Could not extract data from transcript",
        variant: "destructive",
      });
    },
  });

  const reprocessMeetingMutation = useMutation({
    mutationFn: () => apiRequest<ReprocessResult>("POST", `/api/meetings/${id}/reprocess`, {}),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      if (data?.caseId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/cases/:id", data.caseId.toString()],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/cases", data.caseId.toString(), "checklist"],
        });
      }
      toast({
        title: "Meeting Reprocessed",
        description: data?.message || "Intake data extracted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Reprocess Failed",
        description: error?.message || "Could not extract data from transcript",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/communications")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Hub
        </Button>
        <p className="text-muted-foreground">
          {type === "call" ? "Call" : "Meeting"} not found.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/communications")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Hub
        </Button>
        <div>
          <h2 className="text-3xl font-display font-bold text-primary">
            Review {isCall ? "Call" : "Meeting"}
          </h2>
          {selectedCase && (
            <p className="text-muted-foreground mt-1">Case: {selectedCase.deceasedName}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Transcript */}
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Transcript
            </CardTitle>
            {isCall && (
              <SaveAndExtractButton
                onSave={async () => {
                  const original = (item as Call).transcript || "";
                  if (editableTranscript !== original) {
                    await apiRequest("PATCH", `/api/calls/${id}`, {
                      transcript: editableTranscript,
                    });
                    queryClient.invalidateQueries({ queryKey: ["/api/calls", id] });
                    queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
                  }
                }}
                onExtract={() => reprocessCallMutation.mutate()}
                isExtracting={reprocessCallMutation.isPending}
                data-testid="button-reprocess-call"
              />
            )}
            {isMeeting && (
              <SaveAndExtractButton
                onSave={async () => {
                  const original = (item as Meeting).transcript || "";
                  if (editableTranscript !== original) {
                    await apiRequest("PATCH", `/api/meetings/${id}`, {
                      transcript: editableTranscript,
                    });
                    queryClient.invalidateQueries({ queryKey: ["/api/meetings", id] });
                    queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
                    queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
                  }
                }}
                onExtract={() => reprocessMeetingMutation.mutate()}
                isExtracting={reprocessMeetingMutation.isPending}
                data-testid="button-reprocess-meeting"
              />
            )}
          </CardHeader>
          <CardContent>
            <textarea
              value={editableTranscript}
              onChange={(e) => setEditableTranscript(e.target.value)}
              rows={16}
              className="w-full border border-input rounded-md p-4 text-sm bg-background font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              placeholder="No transcript available…"
              data-testid="textarea-transcript"
            />
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Extracted Data */}
          {selectedCase && isIntakeData(selectedCase.intakeData) && (
            <Card className="shadow-sm border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-900/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="w-5 h-5" />
                  Extracted Data
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  AI-extracted information from calls &amp; meetings
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedCase.intakeData.deceasedInfo?.fullName && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Deceased Name</span>
                    <span className="font-medium">
                      {selectedCase.intakeData.deceasedInfo.fullName}
                    </span>
                  </div>
                )}
                {selectedCase.intakeData.callerInfo?.relationship && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Caller Relationship</span>
                    <span className="font-medium">
                      {selectedCase.intakeData.callerInfo.relationship}
                    </span>
                  </div>
                )}
                {selectedCase.intakeData.deceasedInfo?.dateOfDeath && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Date of Death</span>
                    <span className="font-medium">
                      {selectedCase.intakeData.deceasedInfo.dateOfDeath}
                    </span>
                  </div>
                )}
                {selectedCase.intakeData.callerInfo?.phone && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Contact Number</span>
                    <span className="font-medium">
                      {selectedCase.intakeData.callerInfo.phone}
                    </span>
                  </div>
                )}
                {selectedCase.intakeData.callerInfo?.name && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Caller Name</span>
                    <span className="font-medium">
                      {selectedCase.intakeData.callerInfo.name}
                    </span>
                  </div>
                )}
                {selectedCase.intakeData.servicePreferences?.religion && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Religion</span>
                    <span className="font-medium">
                      {selectedCase.intakeData.servicePreferences.religion}
                    </span>
                  </div>
                )}
                {selectedCase.intakeData.servicePreferences?.urgency && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Urgency</span>
                    <Badge
                      variant={
                        selectedCase.intakeData.servicePreferences.urgency === "urgent-24hr"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {selectedCase.intakeData.servicePreferences.urgency === "urgent-24hr"
                        ? "Urgent (24hr)"
                        : "Normal"}
                    </Badge>
                  </div>
                )}
                {selectedCase.intakeData.servicePreferences?.burialOrCremation && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Burial/Cremation</span>
                    <span className="font-medium capitalize">
                      {selectedCase.intakeData.servicePreferences.burialOrCremation}
                    </span>
                  </div>
                )}
                {selectedCase.intakeData.deceasedInfo?.currentLocation && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Current Location</span>
                    <span className="font-medium">
                      {selectedCase.intakeData.deceasedInfo.currentLocation}
                    </span>
                  </div>
                )}
                {selectedCase.intakeData.servicePreferences?.cemeteryOrCrematorium && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Cemetery/Crematorium</span>
                    <span className="font-medium">
                      {selectedCase.intakeData.servicePreferences.cemeteryOrCrematorium}
                    </span>
                  </div>
                )}
                {selectedCase.intakeData.servicePreferences?.serviceType && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Service Type</span>
                    <span className="font-medium">
                      {selectedCase.intakeData.servicePreferences.serviceType}
                    </span>
                  </div>
                )}
                {!selectedCase.intakeData.deceasedInfo?.fullName &&
                  !selectedCase.intakeData.callerInfo?.relationship &&
                  !selectedCase.intakeData.callerInfo?.phone && (
                    <p className="text-sm text-muted-foreground italic">
                      Click "Extract Data" to analyse the transcript.
                    </p>
                  )}
              </CardContent>
            </Card>
          )}

          {/* What's Next checklist */}
          {caseId && checklist && (
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ClipboardList className="w-5 h-5" />
                  What's Next
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {checklist.completedCount}/{checklist.totalItems} items complete
                </p>
                <div className="h-2 mt-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${checklist.completedPercentage}%` }}
                  />
                </div>
              </CardHeader>
              <CardContent className="max-h-[400px] overflow-y-auto">
                {["critical", "important", "supplementary"].map((category) => {
                  const items = groupedChecklist[category] || [];
                  const incompleteItems = items.filter((i) => !i.isCompleted);
                  if (incompleteItems.length === 0) return null;
                  const config = categoryConfig[category];
                  return (
                    <div key={category} className="mb-4">
                      <h4
                        className={`text-xs font-semibold uppercase tracking-wide mb-2 ${config.iconColor}`}
                      >
                        {config.label} — {incompleteItems.length} remaining
                      </h4>
                      <div className="space-y-1">
                        {incompleteItems.slice(0, 3).map((item) => {
                          const canToggle = !item.fieldMapping || !item.isCompleted;
                          return (
                            <button
                              key={item.id}
                              onClick={() =>
                                canToggle && toggleChecklistMutation.mutate(item.id)
                              }
                              disabled={toggleChecklistMutation.isPending || !canToggle}
                              className={`flex items-start gap-2 p-2 rounded text-xs w-full text-left transition-colors ${config.bgColor} ${canToggle ? "hover:opacity-80 cursor-pointer" : "cursor-default"}`}
                              data-testid={`checklist-item-${item.id}`}
                            >
                              <div
                                className={`w-3 h-3 border-2 rounded flex-shrink-0 mt-0.5 ${config.iconColor} border-current`}
                              />
                              <span className="flex-1">{item.question}</span>
                            </button>
                          );
                        })}
                        {incompleteItems.length > 3 && (
                          <p className="text-xs text-muted-foreground pl-5">
                            +{incompleteItems.length - 3} more items
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {checklist.completedPercentage === 100 && (
                  <div className="text-center py-4">
                    <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />
                    <p className="font-medium text-green-700 dark:text-green-400">
                      All items complete!
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Ready to generate documents
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start gap-2" asChild>
                <Link href={caseId ? `/cases/${caseId}` : "/cases"}>
                  <ChevronRight className="w-4 h-4" /> View Full Case
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2">
                <FileText className="w-4 h-4" /> Generate Documents
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
