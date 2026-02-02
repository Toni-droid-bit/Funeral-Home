import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { MakeCallDialog } from "@/components/make-call-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Phone,
  Mic,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileText,
  PhoneIncoming,
  PhoneOutgoing,
  Play,
  Square,
  ChevronRight,
  ClipboardList,
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import type { Call, Meeting, Case } from "@shared/schema";

type Mode = "hub" | "recording" | "review";

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

interface CommunicationItem {
  id: string;
  type: "call" | "meeting";
  title: string;
  subtitle: string;
  timestamp: Date;
  status: string;
  caseId: number | null;
  caseName?: string;
  summary?: string;
  direction?: string;
  originalData: Call | Meeting;
}

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "pl", label: "Polish" },
  { code: "es", label: "Spanish" },
  { code: "zh", label: "Chinese" },
];

export default function Communications() {
  const [mode, setMode] = useState<Mode>("hub");
    const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<CommunicationItem | null>(null);
  const [directorName, setDirectorName] = useState("");
  const [language, setLanguage] = useState("en");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [editableTranscript, setEditableTranscript] = useState("");
  const { toast } = useToast();

  const { data: calls = [], isLoading: callsLoading } = useQuery<Call[]>({
    queryKey: ["/api/calls"],
  });

  const { data: meetings = [], isLoading: meetingsLoading } = useQuery<Meeting[]>({
    queryKey: ["/api/meetings"],
  });

  const { data: cases = [] } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
  });

  const { data: checklist, refetch: refetchChecklist } = useQuery<ComputedChecklist>({
    queryKey: ["/api/cases", selectedCaseId, "checklist"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${selectedCaseId}/checklist`);
      if (!res.ok) throw new Error("Failed to fetch checklist");
      return res.json();
    },
    enabled: !!selectedCaseId && mode === "review",
  });

  const toggleChecklistMutation = useMutation({
    mutationFn: async (itemId: string) => {
      return apiRequest("POST", `/api/cases/${selectedCaseId}/checklist/${itemId}/toggle`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCaseId, "checklist"] });
    },
    onError: (error: any) => {
      toast({
        title: "Cannot toggle item",
        description: error?.message || "This item cannot be manually toggled",
        variant: "destructive",
      });
    },
  });

  const isLoading = callsLoading || meetingsLoading;

  // Combine calls and meetings into unified timeline
  const communications: CommunicationItem[] = [
    ...calls.map((call): CommunicationItem => ({
      id: `call-${call.id}`,
      type: "call",
      title: call.callerName || call.callerPhone || "Unknown Caller",
      subtitle: call.direction === "inbound" ? "Incoming Call" : "Outgoing Call",
      timestamp: new Date(call.createdAt || Date.now()),
      status: call.status || "completed",
      caseId: call.caseId,
      caseName: cases.find(c => c.id === call.caseId)?.deceasedName,
      summary: call.summary || undefined,
      direction: call.direction || "inbound",
      originalData: call,
    })),
    ...meetings.map((meeting): CommunicationItem => ({
      id: `meeting-${meeting.id}`,
      type: "meeting",
      title: "Arrangement Meeting",
      subtitle: `Director: ${meeting.directorName}`,
      timestamp: new Date(meeting.createdAt || Date.now()),
      status: meeting.status || "completed",
      caseId: meeting.caseId,
      caseName: cases.find(c => c.id === meeting.caseId)?.deceasedName,
      summary: meeting.summary || undefined,
      originalData: meeting,
    })),
  ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // Get cases that need attention (have calls but no completed meeting, or low checklist completion)
  const casesNeedingAttention = cases.filter(c => {
    const hasCalls = calls.some(call => call.caseId === c.id);
    const hasCompletedMeeting = meetings.some(m => m.caseId === c.id && m.status === "completed");
    return hasCalls && !hasCompletedMeeting;
  });

  const handleStartRecording = () => {
    if (!selectedCaseId) {
      toast({
        title: "Select a case",
        description: "Please select a case before starting the recording",
        variant: "destructive",
      });
      return;
    }
    setMode("recording");
    setIsRecording(true);
    setRecordingTime(0);
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    setMode("review");
    setEditableTranscript("Meeting transcript will appear here after processing...");
  };

  const handleReviewItem = (item: CommunicationItem) => {
    setSelectedItem(item);
    if (item.caseId) {
      setSelectedCaseId(item.caseId.toString());
    }
    if (item.type === "meeting") {
      const meeting = item.originalData as Meeting;
      setEditableTranscript(meeting.transcript || "");
      setDirectorName(meeting.directorName || "");
    } else {
      const call = item.originalData as Call;
      setEditableTranscript(call.transcript || "");
    }
    setMode("review");
  };

  const resetToHub = () => {
    setMode("hub");
    setSelectedItem(null);
    setSelectedCaseId("");
    setEditableTranscript("");
    setIsRecording(false);
    setRecordingTime(0);
  };

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

  // Recording mode
  if (mode === "recording") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={resetToHub}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <div>
            <h2 className="text-3xl font-display font-bold text-primary">Recording Meeting</h2>
            <p className="text-muted-foreground mt-1">
              Case: {cases.find(c => c.id === parseInt(selectedCaseId))?.deceasedName}
            </p>
          </div>
        </div>

        <Card className="max-w-2xl mx-auto">
          <CardContent className="p-8 text-center">
            <div className={`w-32 h-32 mx-auto rounded-full flex items-center justify-center mb-6 ${
              isRecording ? "bg-red-100 dark:bg-red-900/30 animate-pulse" : "bg-muted"
            }`}>
              <Mic className={`w-16 h-16 ${isRecording ? "text-red-600" : "text-muted-foreground"}`} />
            </div>
            
            <div className="text-4xl font-mono mb-6">
              {Math.floor(recordingTime / 60).toString().padStart(2, "0")}:
              {(recordingTime % 60).toString().padStart(2, "0")}
            </div>

            <Button
              size="lg"
              variant={isRecording ? "destructive" : "default"}
              onClick={isRecording ? handleStopRecording : handleStartRecording}
              className="gap-2"
            >
              {isRecording ? (
                <>
                  <Square className="w-5 h-5" /> Stop Recording
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" /> Start Recording
                </>
              )}
            </Button>

            <p className="text-sm text-muted-foreground mt-4">
              {isRecording 
                ? "Recording in progress. Click stop when the meeting ends."
                : "Click to begin recording the arrangement meeting."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Review mode
  if (mode === "review") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={resetToHub}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Hub
          </Button>
          <div>
            <h2 className="text-3xl font-display font-bold text-primary">
              Review {selectedItem?.type === "call" ? "Call" : "Meeting"}
            </h2>
            {selectedCaseId && cases && (
              <p className="text-muted-foreground mt-1">
                Case: {cases.find(c => c.id === parseInt(selectedCaseId))?.deceasedName}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Transcript */}
          <Card className="shadow-sm lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Transcript
              </CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                value={editableTranscript}
                onChange={(e) => setEditableTranscript(e.target.value)}
                rows={16}
                className="w-full border border-input rounded-md p-4 text-sm bg-background font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                placeholder="No transcript available..."
                data-testid="textarea-transcript"
              />
            </CardContent>
          </Card>

          {/* Checklist & Next Steps */}
          <div className="space-y-4">
            {selectedCaseId && checklist && (
              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ClipboardList className="w-5 h-5" />
                    What's Next
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {checklist.completedCount}/{checklist.totalItems} items complete
                  </p>
                  <Progress value={checklist.completedPercentage} className="h-2 mt-2" />
                </CardHeader>
                <CardContent className="max-h-[400px] overflow-y-auto">
                  {["critical", "important", "supplementary"].map(category => {
                    const items = groupedChecklist[category] || [];
                    const incompleteItems = items.filter(i => !i.isCompleted);
                    if (incompleteItems.length === 0) return null;
                    const config = categoryConfig[category];

                    return (
                      <div key={category} className="mb-4">
                        <h4 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${config.iconColor}`}>
                          {config.label} - {incompleteItems.length} remaining
                        </h4>
                        <div className="space-y-1">
                          {incompleteItems.slice(0, 3).map(item => {
                            const canToggle = !item.fieldMapping || !item.isCompleted;
                            return (
                              <button
                                key={item.id}
                                onClick={() => canToggle && toggleChecklistMutation.mutate(item.id)}
                                disabled={toggleChecklistMutation.isPending || !canToggle}
                                className={`flex items-start gap-2 p-2 rounded text-xs w-full text-left transition-colors ${config.bgColor} ${canToggle ? "hover:opacity-80 cursor-pointer" : "cursor-default"}`}
                                data-testid={`checklist-item-${item.id}`}
                              >
                                <div className={`w-3 h-3 border-2 rounded flex-shrink-0 mt-0.5 ${config.iconColor} border-current`} />
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
                      <p className="font-medium text-green-700 dark:text-green-400">All items complete!</p>
                      <p className="text-sm text-muted-foreground">Ready to generate documents</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start gap-2" asChild>
                  <Link href={selectedCaseId ? `/cases/${selectedCaseId}` : "/cases"}>
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

  // Hub mode - main communications view
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-primary">Communications Hub</h1>
          <p className="text-muted-foreground mt-1">
            All calls and meetings in one place
          </p>
        </div>
        <div className="flex gap-2">
          <MakeCallDialog trigger={
            <Button className="gap-2" data-testid="button-make-call">
              <Phone className="w-4 h-4" /> Make Call
            </Button>
          } />
        </div>
      </div>

      {/* Cases Needing Attention */}
      {casesNeedingAttention.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertCircle className="w-5 h-5" />
              Action Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {casesNeedingAttention.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
                  <div>
                    <p className="font-medium">{c.deceasedName}</p>
                    <p className="text-sm text-muted-foreground">Has call data but no meeting recorded</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedCaseId(c.id.toString());
                        handleStartRecording();
                      }}
                      data-testid={`button-start-meeting-${c.id}`}
                    >
                      <Mic className="w-4 h-4 mr-2" /> Start Meeting
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Start Recording */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1">
              <h3 className="font-semibold text-lg">Start New Meeting Recording</h3>
              <p className="text-sm text-muted-foreground">Record an arrangement meeting and get automatic transcription</p>
            </div>
            <div className="flex items-center gap-3">
              <Select value={selectedCaseId} onValueChange={setSelectedCaseId}>
                <SelectTrigger className="w-[200px]" data-testid="select-case">
                  <SelectValue placeholder="Select case" />
                </SelectTrigger>
                <SelectContent>
                  {cases.map(c => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.deceasedName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleStartRecording} className="gap-2" data-testid="button-start-recording">
                <Mic className="w-4 h-4" /> Record
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Communications Timeline */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
        
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : communications.length === 0 ? (
          <div className="text-center py-12 bg-muted/10 rounded-xl border border-dashed">
            <Phone className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium">No communications yet</h3>
            <p className="text-muted-foreground">Calls and meetings will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {communications.map(item => (
              <Card
                key={item.id}
                className="hover-elevate cursor-pointer transition-all"
                onClick={() => handleReviewItem(item)}
                data-testid={`communication-${item.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-full ${
                      item.type === "call" 
                        ? "bg-green-100 dark:bg-green-900/30" 
                        : "bg-blue-100 dark:bg-blue-900/30"
                    }`}>
                      {item.type === "call" ? (
                        item.direction === "inbound" 
                          ? <PhoneIncoming className="w-5 h-5 text-green-600 dark:text-green-400" />
                          : <PhoneOutgoing className="w-5 h-5 text-green-600 dark:text-green-400" />
                      ) : (
                        <Mic className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium">{item.title}</h3>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="text-sm text-muted-foreground">{item.subtitle}</p>
                      {item.caseName && (
                        <Badge variant="outline" className="mt-2 text-xs">
                          Case: {item.caseName}
                        </Badge>
                      )}
                      {item.summary && (
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{item.summary}</p>
                      )}
                    </div>

                    <div className="text-right flex-shrink-0">
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="w-4 h-4" />
                        {format(item.timestamp, "MMM d, h:mm a")}
                      </div>
                      <Button variant="ghost" size="sm" className="mt-2">
                        Review <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
