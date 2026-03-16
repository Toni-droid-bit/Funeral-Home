import { useState } from "react";
import { useCase } from "@/hooks/use-cases";
import { useParams, useLocation } from "wouter";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Phone, Mic, FileText, ArrowLeft, Loader2, Calendar, CheckCircle2, ClipboardList, Trash2, Pencil, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InlineEditField } from "@/components/inline-edit-field";
import type { Call, Meeting, Document } from "@shared/schema";

interface CaseWithRelations {
  id: number;
  deceasedName: string;
  dateOfDeath: Date | null;
  status: string;
  religion: string | null;
  language: string | null;
  notes: string | null;
  intakeData: any;
  createdAt: Date | null;
  documents?: Document[];
}

interface ChecklistItemWithStatus {
  id: string;
  question: string;
  category: string;
  section?: string;
  fieldMapping?: string;
  isCompleted: boolean;
  isManuallyCompleted: boolean;
}

interface ComputedChecklist {
  items: ChecklistItemWithStatus[];
  completedCount: number;
  totalItems: number;
  completedPercentage: number;
}

export default function CaseDetail() {
  const { id } = useParams();
  const caseId = Number(id);
  const [, navigate] = useLocation();
  const { data: caseData, isLoading } = useCase(caseId) as { data: CaseWithRelations | null | undefined, isLoading: boolean };
  const { toast } = useToast();
  const [transcriptDialog, setTranscriptDialog] = useState<{ open: boolean; content: string; director: string }>({ open: false, content: "", director: "" });

  const { data: calls = [] } = useQuery<Call[]>({
    queryKey: ["/api/cases", caseId, "calls"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/calls`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!caseId,
  });

  const { data: meetings = [] } = useQuery<Meeting[]>({
    queryKey: ["/api/cases", caseId, "meetings"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/meetings`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!caseId,
  });

  const { data: checklist } = useQuery<ComputedChecklist>({
    queryKey: ["/api/cases", caseId, "checklist"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/checklist`);
      if (!res.ok) throw new Error("Failed to fetch checklist");
      return res.json();
    },
    enabled: !!caseId,
  });

  const patchCaseMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("PATCH", `/api/cases/${caseId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases/:id", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
    },
    onError: () => {
      toast({ title: "Save failed", description: "Could not save changes.", variant: "destructive" });
    },
  });

  const deleteCaseMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/cases/${caseId}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      navigate("/cases");
      toast({ title: "Case deleted", description: "The case has been permanently deleted." });
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not delete this case.", variant: "destructive" });
    },
  });

  const toggleChecklistMutation = useMutation({
    mutationFn: async (itemId: string) => {
      return apiRequest("POST", `/api/cases/${caseId}/checklist/${itemId}/toggle`, {});
    },
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

  const generateSummaryMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/cases/${caseId}/generate-intake-summary`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases/:id", caseId] });
      toast({ title: "Document Generated", description: "Intake summary has been created successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to generate document", description: error?.message || "Could not generate intake summary", variant: "destructive" });
    },
  });

  const handleDeleteCase = () => {
    if (confirm(`Are you sure you want to permanently delete the case for "${caseData?.deceasedName}"? This cannot be undone.`)) {
      deleteCaseMutation.mutate();
    }
  };

  const saveField = async (data: any) => {
    await patchCaseMutation.mutateAsync(data);
  };

  const saveIntakeField = async (section: string, field: string, value: string) => {
    await saveField({ intakeData: { [section]: { [field]: value } } });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-primary">Case Not Found</h2>
        <Link href="/cases" className="text-muted-foreground hover:underline mt-2 inline-block">
          &larr; Return to Cases
        </Link>
      </div>
    );
  }

  const intake = (caseData.intakeData as any) || {};

  const categoryConfig: Record<string, { label: string; bgColor: string; iconColor: string }> = {
    critical: { label: "Critical", bgColor: "bg-red-50 dark:bg-red-900/20", iconColor: "text-red-600 dark:text-red-400" },
    important: { label: "Important", bgColor: "bg-amber-50 dark:bg-amber-900/20", iconColor: "text-amber-600 dark:text-amber-400" },
    supplementary: { label: "Supplementary", bgColor: "bg-blue-50 dark:bg-blue-900/20", iconColor: "text-blue-600 dark:text-blue-400" },
  };

  const groupedChecklist = checklist?.items?.reduce((acc, item) => {
    const cat = item.category || "supplementary";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, ChecklistItemWithStatus[]>) || {};

  // Missing items grouped by section (for sidebar display)
  const missingSections = (() => {
    if (!checklist?.items) return {} as Record<string, ChecklistItemWithStatus[]>;
    return checklist.items
      .filter(item => !item.isCompleted)
      .reduce((acc, item) => {
        const sec = item.section || "General";
        if (!acc[sec]) acc[sec] = [];
        acc[sec].push(item);
        return acc;
      }, {} as Record<string, ChecklistItemWithStatus[]>);
  })();

  const missingCriticalCount = checklist?.items?.filter(i => i.category === "critical" && !i.isCompleted).length ?? 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Link href="/cases">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div className="flex-1">
          {/* Inline editable case name */}
          <div className="flex items-center gap-2 group">
            <h1 className="text-3xl font-display font-bold text-primary leading-tight">
              <InlineEditField
                value={caseData.deceasedName}
                onSave={(v) => saveField({ deceasedName: v })}
                placeholder="Case Name"
                displayClassName="text-3xl font-display font-bold text-primary"
                inputClassName="text-3xl font-display font-bold text-primary border-primary"
              />
            </h1>
            <Pencil className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
            <StatusBadge status={caseData.status || "active"} />
            <span>•</span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Created {caseData.createdAt ? format(new Date(caseData.createdAt), "MMMM d, yyyy") : ""}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/30 hover:bg-destructive/10 gap-2"
          onClick={handleDeleteCase}
          disabled={deleteCaseMutation.isPending}
        >
          {deleteCaseMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          Delete Case
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle>Case Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Top-level case fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Religion / Tradition</h4>
                  <InlineEditField
                    value={caseData.religion}
                    onSave={(v) => saveField({ religion: v })}
                    placeholder="Not specified"
                    displayClassName="text-base font-medium"
                  />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Preferred Language</h4>
                  <InlineEditField
                    value={caseData.language}
                    onSave={(v) => saveField({ language: v })}
                    placeholder="English"
                    displayClassName="text-base font-medium"
                  />
                </div>
              </div>

              <Separator />

              {/* Intake data fields */}
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3">Extracted Intake Data</h4>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <InlineEditField
                    label="Deceased Full Name"
                    value={intake.deceasedInfo?.fullName}
                    onSave={(v) => saveIntakeField("deceasedInfo", "fullName", v)}
                    placeholder="Not recorded"
                  />
                  <InlineEditField
                    label="Date of Death"
                    value={intake.deceasedInfo?.dateOfDeath}
                    onSave={(v) => saveIntakeField("deceasedInfo", "dateOfDeath", v)}
                    placeholder="Not recorded"
                  />
                  <InlineEditField
                    label="Date of Birth"
                    value={intake.deceasedInfo?.dateOfBirth}
                    onSave={(v) => saveIntakeField("deceasedInfo", "dateOfBirth", v)}
                    placeholder="Not recorded"
                  />
                  <InlineEditField
                    label="Current Location"
                    value={intake.deceasedInfo?.currentLocation}
                    onSave={(v) => saveIntakeField("deceasedInfo", "currentLocation", v)}
                    placeholder="Not recorded"
                  />
                  <InlineEditField
                    label="Cause of Death"
                    value={intake.deceasedInfo?.causeOfDeath}
                    onSave={(v) => saveIntakeField("deceasedInfo", "causeOfDeath", v)}
                    placeholder="Not recorded"
                  />
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3">Caller / Next of Kin</h4>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <InlineEditField
                    label="Caller Name"
                    value={intake.callerInfo?.name}
                    onSave={(v) => saveIntakeField("callerInfo", "name", v)}
                    placeholder="Not recorded"
                  />
                  <InlineEditField
                    label="Phone Number"
                    value={intake.callerInfo?.phone}
                    onSave={(v) => saveIntakeField("callerInfo", "phone", v)}
                    placeholder="Not recorded"
                  />
                  <InlineEditField
                    label="Relationship"
                    value={intake.callerInfo?.relationship}
                    onSave={(v) => saveIntakeField("callerInfo", "relationship", v)}
                    placeholder="Not recorded"
                  />
                  <InlineEditField
                    label="Email"
                    value={intake.callerInfo?.email}
                    onSave={(v) => saveIntakeField("callerInfo", "email", v)}
                    placeholder="Not recorded"
                  />
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3">Service Preferences</h4>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <InlineEditField
                    label="Burial / Cremation"
                    value={intake.servicePreferences?.burialOrCremation}
                    onSave={(v) => saveIntakeField("servicePreferences", "burialOrCremation", v)}
                    placeholder="Not decided"
                  />
                  <InlineEditField
                    label="Religion"
                    value={intake.servicePreferences?.religion}
                    onSave={(v) => saveIntakeField("servicePreferences", "religion", v)}
                    placeholder="Not specified"
                  />
                  <InlineEditField
                    label="Service Type"
                    value={intake.servicePreferences?.serviceType}
                    onSave={(v) => saveIntakeField("servicePreferences", "serviceType", v)}
                    placeholder="Not specified"
                  />
                  <InlineEditField
                    label="Cemetery / Crematorium"
                    value={intake.servicePreferences?.cemeteryOrCrematorium}
                    onSave={(v) => saveIntakeField("servicePreferences", "cemeteryOrCrematorium", v)}
                    placeholder="Not specified"
                  />
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Notes</h4>
                {(() => {
                  const raw = caseData.notes || "";
                  const lines = raw.split("\n");
                  const warnings = lines.filter(l => l.startsWith("⚠️"));
                  const rest = lines.filter(l => !l.startsWith("⚠️")).join("\n").trim();
                  return (
                    <>
                      {warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2 mb-2 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-300 text-sm">
                          <span className="shrink-0">⚠️</span>
                          <span>{w.replace("⚠️", "").trim()}</span>
                        </div>
                      ))}
                      <p className="text-sm leading-relaxed text-foreground/80 bg-muted/30 p-4 rounded-md">
                        {rest || "No additional notes provided."}
                      </p>
                    </>
                  );
                })()}
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="checklist" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="checklist" className="gap-2" data-testid="tab-checklist">
                <ClipboardList className="w-4 h-4" /> Checklist
              </TabsTrigger>
              <TabsTrigger value="xlink" className="gap-2" data-testid="tab-calls">
                <Phone className="w-4 h-4" /> Calls
              </TabsTrigger>
              <TabsTrigger value="xscribe" className="gap-2" data-testid="tab-meetings">
                <Mic className="w-4 h-4" /> Meetings
              </TabsTrigger>
              <TabsTrigger value="docs" className="gap-2" data-testid="tab-docs">
                <FileText className="w-4 h-4" /> Documents
              </TabsTrigger>
            </TabsList>

            <TabsContent value="checklist" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-lg">Intake Checklist</CardTitle>
                  <div className="flex items-center gap-3">
                    {checklist && (
                      <span className="text-sm text-muted-foreground">
                        {checklist.completedCount}/{checklist.totalItems} complete
                      </span>
                    )}
                    <Button
                      size="sm"
                      onClick={() => generateSummaryMutation.mutate()}
                      disabled={generateSummaryMutation.isPending}
                      data-testid="button-generate-summary"
                    >
                      {generateSummaryMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <FileText className="w-4 h-4 mr-2" />
                      )}
                      Generate Summary
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {checklist && (
                    <div className="space-y-4">
                      <Progress value={checklist.completedPercentage} className="h-2" />

                      {["critical", "important", "supplementary"].map(category => {
                        const items = groupedChecklist[category] || [];
                        if (items.length === 0) return null;
                        const config = categoryConfig[category];
                        const completedInCategory = items.filter(i => i.isCompleted).length;

                        return (
                          <div key={category} className="space-y-2">
                            <h4 className={`text-sm font-semibold flex items-center justify-between gap-2 ${config.iconColor}`}>
                              <span>{config.label}</span>
                              <span className="text-muted-foreground">{completedInCategory}/{items.length}</span>
                            </h4>
                            <div className="space-y-1">
                              {items.map(item => {
                                const isAutoCompleted = item.fieldMapping && item.isCompleted && !item.isManuallyCompleted;
                                const canToggle = !isAutoCompleted;

                                return (
                                  <button
                                    key={item.id}
                                    onClick={() => canToggle && toggleChecklistMutation.mutate(item.id)}
                                    disabled={toggleChecklistMutation.isPending || !canToggle}
                                    className={`flex items-start gap-2 p-2 rounded text-sm w-full text-left transition-colors ${
                                      item.isCompleted
                                        ? "bg-green-50 dark:bg-green-900/20"
                                        : config.bgColor
                                    } ${canToggle ? "hover:opacity-80 cursor-pointer" : "cursor-default"}`}
                                    data-testid={`checklist-item-${item.id}`}
                                  >
                                    {item.isCompleted ? (
                                      <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                                    ) : (
                                      <div className={`w-4 h-4 border-2 rounded flex-shrink-0 mt-0.5 ${config.iconColor} border-current`} />
                                    )}
                                    <span className={`flex-1 ${item.isCompleted ? "text-green-700 dark:text-green-300" : "text-foreground"}`}>
                                      {item.question}
                                    </span>
                                    {isAutoCompleted && (
                                      <span className="text-xs text-muted-foreground">(auto)</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!checklist && (
                    <div className="text-center py-8 text-muted-foreground">
                      <ClipboardList className="w-12 h-12 mx-auto opacity-20 mb-3" />
                      <p>Loading checklist...</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="xlink" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Call Log History</CardTitle>
                </CardHeader>
                <CardContent>
                  {calls.length > 0 ? (
                    <div className="space-y-3">
                      {calls.map(call => (
                        <div key={call.id} className="p-3 rounded-lg bg-muted/30 border">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium">{call.callerName || call.callerPhone}</span>
                            <StatusBadge status={call.status || "completed"} />
                          </div>
                          {call.summary && (
                            <p className="text-sm text-muted-foreground">{call.summary}</p>
                          )}
                          <div className="text-xs text-muted-foreground mt-2">
                            {call.createdAt && format(new Date(call.createdAt), "MMM d, yyyy h:mm a")}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Phone className="w-12 h-12 mx-auto opacity-20 mb-3" />
                      <p>No calls recorded for this case yet.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="xscribe" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Meeting Transcripts</CardTitle>
                </CardHeader>
                <CardContent>
                  {meetings.length > 0 ? (
                    <div className="space-y-3">
                      {meetings.map(meeting => (
                        <div key={meeting.id} className="p-3 rounded-lg bg-muted/30 border">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium">Meeting with {meeting.directorName}</span>
                            <StatusBadge status={meeting.status || "completed"} />
                          </div>
                          {meeting.summary && (
                            <p className="text-sm text-muted-foreground">{meeting.summary}</p>
                          )}
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-muted-foreground">
                              {meeting.createdAt && format(new Date(meeting.createdAt), "MMM d, yyyy h:mm a")}
                            </span>
                            {meeting.transcript && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                onClick={() => setTranscriptDialog({ open: true, content: meeting.transcript!, director: meeting.directorName || "Unknown" })}
                              >
                                <FileText className="w-3 h-3" />
                                View Full Transcript
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Mic className="w-12 h-12 mx-auto opacity-20 mb-3" />
                      <p>No arrangement meetings recorded yet.</p>
                      <Link href="/communications">
                        <Button variant="outline" className="mt-4">Start Recording</Button>
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="docs" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-lg">Generated Documents</CardTitle>
                  <Button
                    size="sm"
                    onClick={() => generateSummaryMutation.mutate()}
                    disabled={generateSummaryMutation.isPending}
                    data-testid="button-generate-summary-docs"
                  >
                    {generateSummaryMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <FileText className="w-4 h-4 mr-2" />
                    )}
                    Generate Summary
                  </Button>
                </CardHeader>
                <CardContent>
                  {caseData.documents && caseData.documents.length > 0 ? (
                    <div className="space-y-3">
                      {caseData.documents.map((doc: any) => (
                        <div key={doc.id} className="p-4 rounded-lg bg-muted/30 border" data-testid={`document-item-${doc.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-3">
                              <FileText className="w-5 h-5 text-primary mt-0.5" />
                              <div>
                                <p className="font-medium">{doc.title}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {doc.type === 'intake_summary' ? 'Intake Summary' : doc.type}
                                  {doc.createdAt && ` • ${format(new Date(doc.createdAt), "MMM d, yyyy h:mm a")}`}
                                </p>
                              </div>
                            </div>
                          </div>
                          {doc.content && (
                            <div className="mt-3 p-3 bg-background rounded border text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                              {doc.content}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <FileText className="w-12 h-12 mx-auto opacity-20 mb-3" />
                      <p>No documents generated yet.</p>
                      <p className="text-sm mt-2">Use the "Generate Summary" button to create an intake summary.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <Dialog open={transcriptDialog.open} onOpenChange={(open) => setTranscriptDialog(prev => ({ ...prev, open }))}>
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>Meeting Transcript — {transcriptDialog.director}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="h-[60vh] pr-4">
              <div className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
                {transcriptDialog.content}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        <div className="space-y-6">
          {/* Completion progress card */}
          {checklist && (
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between gap-2">
                  <span>Case Completion</span>
                  <span className={`text-2xl font-bold tabular-nums ${
                    checklist.completedPercentage >= 80 ? "text-green-600 dark:text-green-400"
                    : checklist.completedPercentage >= 50 ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400"
                  }`}>
                    {checklist.completedPercentage}%
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Progress value={checklist.completedPercentage} className="h-3" />
                  <p className="text-xs text-muted-foreground mt-1">
                    {checklist.completedCount} of {checklist.totalItems} items answered
                  </p>
                </div>

                {missingCriticalCount > 0 && (
                  <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                      {missingCriticalCount} critical item{missingCriticalCount !== 1 ? "s" : ""} unanswered
                    </p>
                  </div>
                )}

                {Object.keys(missingSections).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Still needed
                    </p>
                    <div className="space-y-3">
                      {Object.entries(missingSections).map(([section, items]) => (
                        <div key={section}>
                          <p className="text-xs font-medium text-foreground mb-1">{section}</p>
                          <ul className="space-y-1">
                            {items.map(item => (
                              <li key={item.id} className={`flex items-center gap-1.5 text-xs ${
                                item.category === "critical"
                                  ? "text-red-600 dark:text-red-400"
                                  : item.category === "important"
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-muted-foreground"
                              }`}>
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                  item.category === "critical" ? "bg-red-500"
                                  : item.category === "important" ? "bg-amber-500"
                                  : "bg-muted-foreground"
                                }`} />
                                {item.question}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(missingSections).length === 0 && (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm font-medium">All items complete!</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="bg-primary/5 border-primary/10 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/communications">
                <Button className="w-full justify-start gap-2" variant="outline">
                  <Mic className="w-4 h-4 text-blue-600" />
                  Start Arrangement Meeting
                </Button>
              </Link>
              <Button className="w-full justify-start gap-2" variant="outline">
                <FileText className="w-4 h-4 text-amber-600" />
                Generate Obituary
              </Button>
              <Button className="w-full justify-start gap-2" variant="outline">
                <Phone className="w-4 h-4 text-green-600" />
                Log Manual Call
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
