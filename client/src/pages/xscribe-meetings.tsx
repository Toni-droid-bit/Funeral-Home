import { useMeetings } from "@/hooks/use-meetings";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mic, FileText, CheckCircle2, Play } from "lucide-react";
import { format } from "date-fns";
import { StatusBadge } from "@/components/status-badge";

export default function XScribeMeetings() {
  const { data: meetings, isLoading } = useMeetings();

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-display font-bold text-primary">xScribe Meetings</h2>
          <p className="text-muted-foreground mt-1">Arrangement meeting transcripts, summaries, and action items.</p>
        </div>
        <Button className="bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-200">
          <Mic className="w-4 h-4 mr-2" />
          Start New Recording
        </Button>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading meetings...</div>
        ) : meetings?.map((meeting) => (
          <Card key={meeting.id} className="shadow-sm hover:shadow-md transition-shadow border-border/60">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row gap-6">
                <div className="min-w-[200px]">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-blue-100 rounded-full">
                      <Mic className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Arrangement Meeting</h3>
                      <p className="text-sm text-muted-foreground">Director: {meeting.directorName || "Unknown"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <StatusBadge status={meeting.status || "processing"} />
                    <Badge variant="outline" className="text-xs bg-secondary/50 border-secondary">
                      {meeting.language || "English"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {meeting.createdAt ? format(new Date(meeting.createdAt), "MMM d, yyyy • h:mm a") : ""}
                  </p>
                </div>

                <div className="flex-1 space-y-4">
                  {meeting.summary ? (
                    <div>
                      <p className="text-sm font-medium text-primary mb-1">Meeting Summary</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{meeting.summary}</p>
                    </div>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">Processing transcript...</p>
                  )}

                  {meeting.actionItems && Array.isArray(meeting.actionItems) && (meeting.actionItems as string[]).length > 0 && (
                    <div className="bg-green-50/50 p-3 rounded-lg border border-green-100">
                      <p className="text-sm font-medium text-green-800 mb-2 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" /> Action Items
                      </p>
                      <ul className="space-y-1">
                        {(meeting.actionItems as string[]).map((item: string, idx: number) => (
                          <li key={idx} className="text-sm text-green-700/80 pl-2 border-l-2 border-green-200">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex md:flex-col justify-end gap-2 min-w-[140px]">
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                    <FileText className="w-4 h-4" /> Full Transcript
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-primary">
                    <Play className="w-4 h-4" /> Listen
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {meetings?.length === 0 && (
          <div className="text-center py-20 bg-muted/10 rounded-xl border border-dashed border-border">
            <Mic className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium">No meetings recorded</h3>
            <p className="text-muted-foreground">Start a recording to generate transcripts and action items.</p>
          </div>
        )}
      </div>
    </div>
  );
}
