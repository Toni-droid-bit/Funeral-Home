import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LANGUAGES as SHARED_LANGUAGES } from "@/constants/checklist-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/status-badge";
import { MakeCallDialog } from "@/components/make-call-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Phone,
  Mic,
  Loader2,
  AlertCircle,
  Clock,
  PhoneIncoming,
  PhoneOutgoing,
  ChevronRight,
  ChevronsUpDown,
  Check,
  PlusCircle,
} from "lucide-react";
import { format } from "date-fns";
import type { Call, Meeting, Case } from "@shared/schema";

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

export default function CommunicationsHub() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [isEnteringRecording, setIsEnteringRecording] = useState(false);
  const [caseComboOpen, setCaseComboOpen] = useState(false);
  // "existing:<id>" | "new:<name>" | "none"
  const [caseSelection, setCaseSelection] = useState<string>("none");
  const [newCaseInputValue, setNewCaseInputValue] = useState("");

  const { data: calls = [], isLoading: callsLoading } = useQuery<Call[]>({
    queryKey: ["/api/calls"],
  });
  const { data: meetings = [], isLoading: meetingsLoading } = useQuery<Meeting[]>({
    queryKey: ["/api/meetings"],
  });
  const { data: cases = [] } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
  });

  const isLoading = callsLoading || meetingsLoading;

  const communications: CommunicationItem[] = [
    ...calls.map((call): CommunicationItem => ({
      id: `call-${call.id}`,
      type: "call",
      title: call.callerName || call.callerPhone || "Unknown Caller",
      subtitle: call.direction === "inbound" ? "Incoming Call" : "Outgoing Call",
      timestamp: new Date(call.createdAt || Date.now()),
      status: call.status || "completed",
      caseId: call.caseId,
      caseName: cases.find((c) => c.id === call.caseId)?.deceasedName,
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
      caseName: cases.find((c) => c.id === meeting.caseId)?.deceasedName,
      summary: meeting.summary || undefined,
      originalData: meeting,
    })),
  ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const casesNeedingAttention = cases.filter((c) => {
    const hasCalls = calls.some((call) => call.caseId === c.id);
    const hasCompletedMeeting = meetings.some(
      (m) => m.caseId === c.id && m.status === "completed",
    );
    return hasCalls && !hasCompletedMeeting;
  });

  const handleEnterRecordingMode = async () => {
    setIsEnteringRecording(true);
    try {
      if (caseSelection.startsWith("existing:")) {
        const caseId = caseSelection.slice(9);
        navigate(`/communications/record?caseId=${caseId}&isTempCase=false`);
      } else if (caseSelection.startsWith("new:")) {
        const name = caseSelection.slice(4).trim() || "New Case";
        const newCase = await apiRequest<{ id: number }>("POST", "/api/cases", {
          deceasedName: name,
          status: "active",
          religion: "Unknown",
          language: "English",
        });
        if (!newCase?.id) throw new Error("Case creation returned no ID");
        queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
        navigate(`/communications/record?caseId=${newCase.id}&isTempCase=false`);
      } else {
        // No case — create placeholder so checklist has something to bind to
        const newCase = await apiRequest<{ id: number }>("POST", "/api/cases", {
          deceasedName: "Unknown (Pending)",
          status: "active",
          religion: "Unknown",
          language: "English",
          notes: "Created automatically for meeting recording — name will be detected from transcript.",
        });
        if (!newCase?.id) throw new Error("Case creation returned no ID");
        queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
        navigate(`/communications/record?caseId=${newCase.id}&isTempCase=true`);
      }
    } catch (err: any) {
      toast({
        title: "Failed to start session",
        description: err.message || "Could not create case. Please try again.",
        variant: "destructive",
      });
      setIsEnteringRecording(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-primary">
            Communications Hub
          </h1>
          <p className="text-muted-foreground mt-1">All calls and meetings in one place</p>
        </div>
        <div className="flex gap-2">
          <MakeCallDialog
            trigger={
              <Button className="gap-2" data-testid="button-make-call">
                <Phone className="w-4 h-4" /> Make Call
              </Button>
            }
          />
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
              {casesNeedingAttention.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-3 bg-background rounded-lg border"
                >
                  <div>
                    <p className="font-medium">{c.deceasedName}</p>
                    <p className="text-sm text-muted-foreground">
                      Has call data but no meeting recorded
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      navigate(`/communications/record?caseId=${c.id}&isTempCase=false`)
                    }
                    data-testid={`button-start-meeting-${c.id}`}
                  >
                    <Mic className="w-4 h-4 mr-2" /> Start Meeting
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Start Recording */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-start gap-4">
            <div className="flex-1">
              <h3 className="font-semibold text-lg">Start New Meeting Recording</h3>
              <p className="text-sm text-muted-foreground">
                Record an arrangement meeting and get automatic transcription
              </p>
            </div>
            <div className="flex flex-col gap-2 min-w-[260px]">
              <Popover open={caseComboOpen} onOpenChange={setCaseComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={caseComboOpen}
                    className="w-full justify-between"
                    data-testid="select-case"
                  >
                    <span className="truncate text-left">
                      {caseSelection === "none"
                        ? "No case (auto-detect)"
                        : caseSelection.startsWith("existing:")
                        ? cases.find(
                            (c) => c.id.toString() === caseSelection.slice(9),
                          )?.deceasedName || "Select case"
                        : caseSelection.startsWith("new:")
                        ? `New: ${caseSelection.slice(4)}`
                        : "Select case"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search cases or type new name…"
                      value={newCaseInputValue}
                      onValueChange={(v) => {
                        setNewCaseInputValue(v);
                        if (v.trim()) {
                          const match = cases.find(
                            (c) => c.deceasedName.toLowerCase() === v.toLowerCase(),
                          );
                          if (match) {
                            setCaseSelection(`existing:${match.id}`);
                          } else {
                            setCaseSelection(`new:${v.trim()}`);
                          }
                        } else {
                          setCaseSelection("none");
                        }
                      }}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {newCaseInputValue.trim() ? (
                          <span className="text-sm text-muted-foreground px-2">
                            Press Record to create "{newCaseInputValue}"
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground px-2">
                            No cases found
                          </span>
                        )}
                      </CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="none"
                          onSelect={() => {
                            setCaseSelection("none");
                            setNewCaseInputValue("");
                            setCaseComboOpen(false);
                          }}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${caseSelection === "none" ? "opacity-100" : "opacity-0"}`}
                          />
                          <span className="text-muted-foreground italic">
                            No case — auto-detect from recording
                          </span>
                        </CommandItem>
                      </CommandGroup>
                      {cases.length > 0 && (
                        <>
                          <CommandSeparator />
                          <CommandGroup heading="Existing Cases">
                            {cases
                              .filter(
                                (c) =>
                                  !newCaseInputValue ||
                                  c.deceasedName
                                    .toLowerCase()
                                    .includes(newCaseInputValue.toLowerCase()),
                              )
                              .map((c) => (
                                <CommandItem
                                  key={c.id}
                                  value={`existing:${c.id}`}
                                  onSelect={() => {
                                    setCaseSelection(`existing:${c.id}`);
                                    setNewCaseInputValue(c.deceasedName);
                                    setCaseComboOpen(false);
                                  }}
                                >
                                  <Check
                                    className={`mr-2 h-4 w-4 ${caseSelection === `existing:${c.id}` ? "opacity-100" : "opacity-0"}`}
                                  />
                                  {c.deceasedName}
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </>
                      )}
                      {newCaseInputValue.trim() &&
                        !cases.some(
                          (c) =>
                            c.deceasedName.toLowerCase() ===
                            newCaseInputValue.toLowerCase(),
                        ) && (
                          <>
                            <CommandSeparator />
                            <CommandGroup heading="Create New">
                              <CommandItem
                                value={`new:${newCaseInputValue.trim()}`}
                                onSelect={() => {
                                  setCaseSelection(`new:${newCaseInputValue.trim()}`);
                                  setCaseComboOpen(false);
                                }}
                              >
                                <PlusCircle className="mr-2 h-4 w-4 text-primary" />
                                Create "{newCaseInputValue.trim()}"
                              </CommandItem>
                            </CommandGroup>
                          </>
                        )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <Button
                onClick={handleEnterRecordingMode}
                disabled={isEnteringRecording}
                className="gap-2 w-full"
                data-testid="button-start-recording"
              >
                {isEnteringRecording ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Setting up…
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" /> Record
                  </>
                )}
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
            {communications.map((item) => (
              <Card
                key={item.id}
                className="hover-elevate cursor-pointer transition-all"
                onClick={() => {
                  const rawId = item.type === "call"
                    ? (item.originalData as Call).id
                    : (item.originalData as Meeting).id;
                  navigate(`/communications/review/${item.type}/${rawId}`);
                }}
                data-testid={`communication-${item.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div
                      className={`p-3 rounded-full ${
                        item.type === "call"
                          ? "bg-green-100 dark:bg-green-900/30"
                          : "bg-blue-100 dark:bg-blue-900/30"
                      }`}
                    >
                      {item.type === "call" ? (
                        item.direction === "inbound" ? (
                          <PhoneIncoming className="w-5 h-5 text-green-600 dark:text-green-400" />
                        ) : (
                          <PhoneOutgoing className="w-5 h-5 text-green-600 dark:text-green-400" />
                        )
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
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                          {item.summary}
                        </p>
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
