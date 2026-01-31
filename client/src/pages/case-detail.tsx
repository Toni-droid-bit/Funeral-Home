import { useCase } from "@/hooks/use-cases";
import { useParams } from "wouter";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Phone, Mic, FileText, ArrowLeft, Loader2, Calendar } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

export default function CaseDetail() {
  const { id } = useParams();
  const { data: caseData, isLoading } = useCase(Number(id));

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
        {/* Main Details Panel */}
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

          <Tabs defaultValue="xlink" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="xlink" className="gap-2">
                <Phone className="w-4 h-4" /> xLink Calls
              </TabsTrigger>
              <TabsTrigger value="xscribe" className="gap-2">
                <Mic className="w-4 h-4" /> xScribe Meetings
              </TabsTrigger>
              <TabsTrigger value="docs" className="gap-2">
                <FileText className="w-4 h-4" /> Documents
              </TabsTrigger>
            </TabsList>

            <TabsContent value="xlink" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Call Log History</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8 text-muted-foreground">
                    <Phone className="w-12 h-12 mx-auto opacity-20 mb-3" />
                    <p>No calls recorded for this case yet.</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="xscribe" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Meeting Transcripts</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8 text-muted-foreground">
                    <Mic className="w-12 h-12 mx-auto opacity-20 mb-3" />
                    <p>No arrangement meetings recorded yet.</p>
                    <Button variant="outline" className="mt-4">Start Recording</Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="docs" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Generated Documents</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto opacity-20 mb-3" />
                    <p>No documents generated yet.</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Sidebar Actions */}
        <div className="space-y-6">
          <Card className="bg-primary/5 border-primary/10 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full justify-start gap-2" variant="outline">
                <Mic className="w-4 h-4 text-blue-600" />
                Start Arrangement Meeting
              </Button>
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
