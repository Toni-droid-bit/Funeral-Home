import { useCase } from "@/hooks/use-cases";
import { useParams } from "wouter";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Phone, Mic, FileText, ArrowLeft, Loader2, Calendar, CheckCircle2, ClipboardList } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  const { data: caseData, isLoading } = useCase(caseId) as { data: CaseWithRelations | null | undefined, isLoading: boolean };
  const { toast } = useToast();

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
      // Invalidate the case detail query to refresh documents
      queryClient.invalidateQueries({ queryKey: ["/api/cases/:id", caseId] });
      toast({
        title: "Document Generated",
        description: "Intake summary has been created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to generate document",
        description: error?.message || "Could not generate intake summary",
        variant: "destructive",
      });
    },
  });

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

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Link href="/cases">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-display font-bold text-primary">{caseData.deceasedName}</h1>
          <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
            <StatusBadge status={caseData.status || "active"} />
            <span>•</span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Created {caseData.createdAt ? format(new Date(caseData.createdAt), "MMMM d, yyyy") : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle>Case Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Religion / Tradition</h4>
                  <p className="text-lg font-medium">{caseData.religion || "Secular"}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Preferred Language</h4>
                  <p className="text-lg font-medium">{caseData.language || "English"}</p>
                </div>
              </div>
              <Separator />
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Notes</h4>
                <p className="text-sm leading-relaxed text-foreground/80 bg-muted/30 p-4 rounded-md">
                  {caseData.notes || "No additional notes provided."}
                </p>
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
                    {checklist && checklist.completedPercentage === 100 && (
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
                    )}
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
                          <div className="text-xs text-muted-foreground mt-2">
                            {meeting.createdAt && format(new Date(meeting.createdAt), "MMM d, yyyy h:mm a")}
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

        <div className="space-y-6">
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
