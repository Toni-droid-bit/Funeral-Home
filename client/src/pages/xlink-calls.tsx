import { useCalls } from "@/hooks/use-calls";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayCircle, FileText, Phone } from "lucide-react";
import { format } from "date-fns";
import { StatusBadge } from "@/components/status-badge";

export default function XLinkCalls() {
  const { data: calls, isLoading } = useCalls();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold text-primary">xLink Call Logs</h2>
        <p className="text-muted-foreground mt-1">AI-handled reception calls, transcripts, and sentiment analysis.</p>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading calls...</div>
        ) : calls?.map((call) => (
          <Card key={call.id} className="shadow-sm hover:shadow-md transition-shadow border-border/60">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row gap-6">
                {/* Caller Info */}
                <div className="min-w-[200px]">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <Phone className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{call.callerName || "Unknown Caller"}</h3>
                      <p className="text-sm text-muted-foreground">{call.callerPhone}</p>
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
                      <p className="text-sm text-muted-foreground leading-relaxed">{call.summary}</p>
                    </div>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">No summary available yet.</p>
                  )}
                  
                  {call.sentiment && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-muted-foreground">Sentiment:</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${
                        call.sentiment === 'positive' ? 'bg-green-100 text-green-700' : 
                        call.sentiment === 'negative' ? 'bg-red-100 text-red-700' : 
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {call.sentiment}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex md:flex-col justify-end gap-2 min-w-[140px]">
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                    <FileText className="w-4 h-4" /> Transcript
                  </Button>
                  {call.audioUrl && (
                    <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-primary">
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
            <p className="text-muted-foreground">Calls handled by xLink AI will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
