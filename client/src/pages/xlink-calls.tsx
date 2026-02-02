import { useCalls } from "@/hooks/use-calls";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayCircle, FileText, Phone, PhoneOutgoing, FolderOpen, CheckCircle2, Link2 } from "lucide-react";
import { format } from "date-fns";
import { StatusBadge } from "@/components/status-badge";
import { MakeCallDialog } from "@/components/make-call-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

export default function XLinkCalls() {
  const { data: calls, isLoading } = useCalls();
  const { data: cases } = useQuery<any[]>({ queryKey: ["/api/cases"] });

  const getCaseForCall = (caseId: number | null) => {
    if (!caseId || !cases) return null;
    return cases.find(c => c.id === caseId);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-display font-bold text-primary" data-testid="text-page-title">xLink Call Logs</h2>
          <p className="text-muted-foreground mt-1">AI-handled reception calls, transcripts, and sentiment analysis.</p>
        </div>
        <MakeCallDialog />
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading calls...</div>
        ) : calls?.map((call) => (
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
                        {call.callerName || "Unknown Caller"}
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
                  {call.caseId && getCaseForCall(call.caseId) && (
                    <div className="flex items-center gap-2 mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                      <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                      <span className="text-sm text-green-700 dark:text-green-300">
                        Case created: <strong>{getCaseForCall(call.caseId)?.deceasedName}</strong>
                      </span>
                      <Link href={`/cases/${call.caseId}`}>
                        <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs gap-1" data-testid={`button-view-case-${call.id}`}>
                          <FolderOpen className="w-3 h-3" />
                          View Case
                        </Button>
                      </Link>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex md:flex-col justify-end gap-2 min-w-[140px]">
                  {call.transcript && (
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
                        <ScrollArea className="h-[60vh] pr-4">
                          <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                            {call.transcript}
                          </div>
                        </ScrollArea>
                      </DialogContent>
                    </Dialog>
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
        ))}

        {calls?.length === 0 && (
          <div className="text-center py-20 bg-muted/10 rounded-xl border border-dashed border-border">
            <Phone className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium">No calls recorded yet</h3>
            <p className="text-muted-foreground mb-6">Calls handled by xLink AI will appear here.</p>
            <MakeCallDialog 
              trigger={
                <Button className="bg-primary text-primary-foreground" data-testid="button-make-first-call">
                  <Phone className="w-4 h-4 mr-2" />
                  Make Your First Call
                </Button>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
