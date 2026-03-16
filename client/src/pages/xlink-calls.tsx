import { useEffect, useRef, useState } from "react";
import { useCalls } from "@/hooks/use-calls";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayCircle, FileText, Phone, PhoneOutgoing, FolderOpen, CheckCircle2, Sparkles, Loader2, PhoneCall, Save } from "lucide-react";
import { MakeCallDialog } from "@/components/make-call-dialog";
import { format } from "date-fns";
import { StatusBadge } from "@/components/status-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { InlineEditField } from "@/components/inline-edit-field";
import { Textarea } from "@/components/ui/textarea";

export default function XLinkCalls() {
  const { data: calls, isLoading } = useCalls();
  const { data: cases } = useQuery<any[]>({ queryKey: ["/api/cases"] });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const autoExtractedRef = useRef<Set<number>>(new Set());
  const [editedTranscripts, setEditedTranscripts] = useState<Record<number, string>>({});

  const getCaseForCall = (caseId: number | null) => {
    if (!caseId || !cases) return null;
    return cases.find(c => c.id === caseId);
  };

  const reprocessMutation = useMutation({
    mutationFn: async (callId: number) => {
      return apiRequest("POST", `/api/calls/${callId}/reprocess`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
    },
    onError: (err: any) => {
      toast({ title: "Extraction failed", description: err?.message || "Could not extract data from transcript", variant: "destructive" });
    },
  });

  const saveAndReparseMutation = useMutation({
    mutationFn: async ({ callId, caseId, transcript }: { callId: number; caseId: number | null; transcript: string }) => {
      // Step 1: PATCH the call with the new transcript (server also re-parses internally)
      await apiRequest("PATCH", `/api/calls/${callId}`, { transcript });
      // Step 2: If linked to a case, explicitly trigger process-transcript as well
      if (caseId) {
        await apiRequest("POST", `/api/cases/${caseId}/process-transcript`, { transcript });
      }
    },
    onSuccess: (_data, { callId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      // Clear the edited state for this call after a successful save
      setEditedTranscripts(prev => {
        const next = { ...prev };
        delete next[callId];
        return next;
      });
      toast({ title: "Transcript saved & re-parsed", description: "Extracted Data panel has been updated." });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err?.message || "Could not save and re-parse.", variant: "destructive" });
    },
  });

  const patchCaseMutation = useMutation({
    mutationFn: async ({ caseId, data }: { caseId: number; data: any }) => {
      return apiRequest("PATCH", `/api/cases/${caseId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
    },
    onError: () => {
      toast({ title: "Save failed", description: "Could not save field.", variant: "destructive" });
    },
  });

  // Auto-extract on load for any call that has a transcript but whose case is still "Unknown (Pending)" or has no case
  useEffect(() => {
    if (!calls || isLoading) return;
    const unprocessed = calls.filter(call => {
      if (!call.transcript) return false;
      if (autoExtractedRef.current.has(call.id)) return false;
      const linkedCase = getCaseForCall(call.caseId);
      return !call.caseId || linkedCase?.deceasedName === "Unknown (Pending)";
    });
    for (const call of unprocessed) {
      autoExtractedRef.current.add(call.id);
      console.log(`[xlink] auto-extracting data for call ${call.id}`);
      reprocessMutation.mutate(call.id);
    }
  }, [calls, isLoading, cases]);

  const makeIntakeSaver = (caseId: number, section: string, field: string) => async (value: string) => {
    await patchCaseMutation.mutateAsync({
      caseId,
      data: { intakeData: { [section]: { [field]: value } } },
    });
  };

  const makeFieldSaver = (caseId: number, field: string) => async (value: string) => {
    await patchCaseMutation.mutateAsync({ caseId, data: { [field]: value } });
  };

  // Resolve caller name: prefer intake callerInfo.name, fallback to call.callerName, then "Unknown Caller"
  const resolveCallerName = (call: any) => {
    const linkedCase = getCaseForCall(call.caseId);
    return linkedCase?.intakeData?.callerInfo?.name || call.callerName || null;
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-display font-bold text-primary" data-testid="text-page-title">xLink Call Logs</h2>
          <p className="text-muted-foreground mt-1">AI-handled reception calls, transcripts, and sentiment analysis.</p>
        </div>
        <MakeCallDialog trigger={
          <Button className="gap-2" data-testid="button-make-call">
            <PhoneCall className="w-4 h-4" /> Make a Call
          </Button>
        } />
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading calls...</div>
        ) : calls?.map((call) => {
          const linkedCase = getCaseForCall(call.caseId);
          const intake = linkedCase?.intakeData || {};
          const callerName = resolveCallerName(call);

          return (
            <Card key={call.id} className="shadow-sm hover-elevate transition-shadow border-border/60" data-testid={`card-call-${call.id}`}>
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-6">
                  {/* Caller Info */}
                  <div className="min-w-[200px]">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 bg-primary/10 rounded-full">
                        {call.status === "in-progress" ? (
                          <PhoneOutgoing className="w-5 h-5 text-primary animate-pulse" />
                        ) : (
                          <Phone className="w-5 h-5 text-primary" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground" data-testid={`text-caller-name-${call.id}`}>
                          {callerName || "Unknown Caller"}
                        </h3>
                        <p className="text-sm text-muted-foreground" data-testid={`text-caller-phone-${call.id}`}>
                          {call.callerPhone}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <StatusBadge status={call.status || "completed"} />
                      <Badge variant="outline" className="text-xs bg-secondary/50 border-secondary">
                        {call.detectedLanguage}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {call.createdAt ? format(new Date(call.createdAt), "MMM d, yyyy • h:mm a") : ""}
                    </p>
                  </div>

                  {/* Content & Summary */}
                  <div className="flex-1 space-y-3">
                    {call.summary ? (
                      <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
                        <p className="text-sm font-medium text-primary mb-1">AI Summary</p>
                        <p className="text-sm text-muted-foreground leading-relaxed" data-testid={`text-summary-${call.id}`}>
                          {call.summary}
                        </p>
                      </div>
                    ) : call.status === "in-progress" ? (
                      <div className="bg-primary/5 p-3 rounded-lg border border-primary/20">
                        <p className="text-sm font-medium text-primary mb-1">Call In Progress</p>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          The AI assistant is currently on the call. Summary will appear when complete.
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm italic text-muted-foreground">No summary available yet.</p>
                    )}

                    {call.sentiment && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-muted-foreground">Sentiment:</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${
                          call.sentiment.toLowerCase().includes('positive') || call.sentiment.toLowerCase().includes('calm')
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          call.sentiment.toLowerCase().includes('negative') || call.sentiment.toLowerCase().includes('grief') || call.sentiment.toLowerCase().includes('anxious')
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                          'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}>
                          {call.sentiment}
                        </span>
                      </div>
                    )}

                    {/* Case Link Status */}
                    {call.caseId && linkedCase && (
                      <div className="flex items-center gap-2 mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                        <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                        <span className="text-sm text-green-700 dark:text-green-300">
                          Case: <strong>{linkedCase.deceasedName}</strong>
                        </span>
                        <Link href={`/cases/${call.caseId}`}>
                          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs gap-1" data-testid={`button-view-case-${call.id}`}>
                            <FolderOpen className="w-3 h-3" />
                            View Case
                          </Button>
                        </Link>
                      </div>
                    )}

                    {/* Editable intake fields for linked case */}
                    {call.caseId && linkedCase && (
                      <div className="mt-3 relative">
                        {saveAndReparseMutation.isPending && saveAndReparseMutation.variables?.callId === call.id && (
                          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm rounded-lg z-10 flex items-center justify-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                            <span className="text-sm font-medium text-primary">Re-parsing transcript…</span>
                          </div>
                        )}
                        <div className="rounded-lg border border-border/60 overflow-hidden">
                          <div className="px-3 py-2 bg-muted/40 border-b border-border/40 flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Extracted Information</p>
                          </div>
                          <div className="grid grid-cols-2 gap-px bg-border/20">
                            {[
                              { label: "Deceased Name", value: intake.deceasedInfo?.fullName || linkedCase.deceasedName, section: "deceasedInfo", field: "fullName" },
                              { label: "Date of Death", value: intake.deceasedInfo?.dateOfDeath, section: "deceasedInfo", field: "dateOfDeath" },
                              { label: "Caller Name", value: intake.callerInfo?.name, section: "callerInfo", field: "name" },
                              { label: "Phone Number", value: intake.callerInfo?.phone, section: "callerInfo", field: "phone" },
                              { label: "Location", value: intake.deceasedInfo?.currentLocation, section: "deceasedInfo", field: "currentLocation" },
                              { label: "Religion", value: intake.servicePreferences?.religion, section: "servicePreferences", field: "religion" },
                              { label: "Burial / Cremation", value: intake.servicePreferences?.burialOrCremation, section: "servicePreferences", field: "burialOrCremation" },
                              { label: "Relationship", value: intake.callerInfo?.relationship, section: "callerInfo", field: "relationship" },
                            ].map(({ label, value, section, field }) => (
                              <div key={field} className="bg-card px-3 py-2">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
                                <InlineEditField
                                  value={value}
                                  onSave={makeIntakeSaver(linkedCase.id, section, field)}
                                  placeholder="—"
                                  displayClassName="text-xs font-medium"
                                  inputClassName="text-xs h-6 py-0"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex md:flex-col justify-end gap-2 min-w-[140px]">
                    {call.transcript && (
                      <>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="w-full justify-start gap-2" data-testid={`button-transcript-${call.id}`}>
                              <FileText className="w-4 h-4" /> Transcript
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl max-h-[80vh]">
                            <DialogHeader>
                              <DialogTitle>Call Transcript</DialogTitle>
                            </DialogHeader>
                            <Textarea
                              className="h-[55vh] resize-none text-sm font-mono"
                              value={editedTranscripts[call.id] ?? call.transcript ?? ""}
                              onChange={(e) =>
                                setEditedTranscripts(prev => ({ ...prev, [call.id]: e.target.value }))
                              }
                            />
                            <div className="flex justify-end pt-2">
                              <Button
                                size="sm"
                                className="gap-2"
                                disabled={
                                  saveAndReparseMutation.isPending ||
                                  (editedTranscripts[call.id] === undefined ||
                                    editedTranscripts[call.id] === call.transcript)
                                }
                                onClick={() =>
                                  saveAndReparseMutation.mutate({
                                    callId: call.id,
                                    caseId: call.caseId ?? null,
                                    transcript: editedTranscripts[call.id] ?? call.transcript ?? "",
                                  })
                                }
                                data-testid={`button-save-reparse-${call.id}`}
                              >
                                {saveAndReparseMutation.isPending && saveAndReparseMutation.variables?.callId === call.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Save className="w-4 h-4" />
                                )}
                                Save & Re-parse
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start gap-2 text-purple-700 border-purple-200 hover:bg-purple-50"
                          onClick={() => reprocessMutation.mutate(call.id)}
                          disabled={reprocessMutation.isPending}
                          data-testid={`button-extract-${call.id}`}
                        >
                          {reprocessMutation.isPending && reprocessMutation.variables === call.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4" />
                          )}
                          Extract Data
                        </Button>
                      </>
                    )}
                    {!call.transcript && (
                      <Button variant="outline" size="sm" className="w-full justify-start gap-2" disabled>
                        <FileText className="w-4 h-4" /> Transcript
                      </Button>
                    )}
                    {call.audioUrl && (
                      <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-primary" data-testid={`button-play-${call.id}`}>
                        <PlayCircle className="w-4 h-4" /> Play Audio
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {calls?.length === 0 && (
          <div className="text-center py-20 bg-muted/10 rounded-xl border border-dashed border-border">
            <Phone className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium">No calls recorded yet</h3>
            <p className="text-muted-foreground mb-6">Calls handled by xLink AI will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
