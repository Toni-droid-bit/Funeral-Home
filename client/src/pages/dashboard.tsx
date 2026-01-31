import { useDashboardStats } from "@/hooks/use-dashboard";
import { useCalls } from "@/hooks/use-calls";
import { useMeetings } from "@/hooks/use-meetings";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  CardDescription
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Users, Phone, Mic, ArrowRight, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { motion } from "framer-motion";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const item = {
  hidden: { y: 20, opacity: 0 },
  show: { y: 0, opacity: 1 }
};

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: calls, isLoading: callsLoading } = useCalls();
  const { data: meetings, isLoading: meetingsLoading } = useMeetings();

  if (statsLoading || callsLoading || meetingsLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <motion.div 
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-8"
    >
      <div>
        <h2 className="text-3xl font-display font-bold text-primary">Overview</h2>
        <p className="text-muted-foreground mt-1">Welcome back. Here's what's happening today.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div variants={item}>
          <Card className="border-l-4 border-l-primary shadow-md hover:shadow-lg transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Active Cases</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="text-4xl font-bold font-display text-foreground">{stats?.activeCases || 0}</span>
                <div className="p-3 bg-primary/10 rounded-full">
                  <Users className="w-6 h-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card className="border-l-4 border-l-amber-500 shadow-md hover:shadow-lg transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Pending Calls</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="text-4xl font-bold font-display text-foreground">{stats?.pendingCalls || 0}</span>
                <div className="p-3 bg-amber-100 rounded-full">
                  <Phone className="w-6 h-6 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card className="border-l-4 border-l-blue-500 shadow-md hover:shadow-lg transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Upcoming Meetings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="text-4xl font-bold font-display text-foreground">{stats?.upcomingMeetings || 0}</span>
                <div className="p-3 bg-blue-100 rounded-full">
                  <Mic className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Recent Activity Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Calls (xLink) */}
        <motion.div variants={item}>
          <Card className="h-full shadow-md border-border/60">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="font-display text-xl">Recent xLink Calls</CardTitle>
                <CardDescription>AI-handled reception calls</CardDescription>
              </div>
              <Link href="/calls">
                <Button variant="ghost" size="sm" className="gap-2 text-primary hover:text-primary/80">
                  View All <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {calls?.slice(0, 5).map((call) => (
                  <div key={call.id} className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="bg-primary/5 p-2 rounded-full">
                        <Phone className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{call.callerName || "Unknown Caller"}</p>
                        <p className="text-xs text-muted-foreground">{call.callerPhone}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={call.status || "completed"} />
                      <p className="text-xs text-muted-foreground mt-1">
                        {call.createdAt ? format(new Date(call.createdAt), "MMM d, h:mm a") : ""}
                      </p>
                    </div>
                  </div>
                ))}
                {(!calls || calls.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground text-sm">No recent calls recorded</div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent Meetings (xScribe) */}
        <motion.div variants={item}>
          <Card className="h-full shadow-md border-border/60">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="font-display text-xl">Recent xScribe Meetings</CardTitle>
                <CardDescription>Arrangement transcripts & summaries</CardDescription>
              </div>
              <Link href="/meetings">
                <Button variant="ghost" size="sm" className="gap-2 text-primary hover:text-primary/80">
                  View All <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {meetings?.slice(0, 5).map((meeting) => (
                  <div key={meeting.id} className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="bg-blue-500/10 p-2 rounded-full">
                        <Mic className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Arrangement Meeting</p>
                        <p className="text-xs text-muted-foreground">Director: {meeting.directorName || "Staff"}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={meeting.status || "processing"} />
                      <p className="text-xs text-muted-foreground mt-1">
                        {meeting.createdAt ? format(new Date(meeting.createdAt), "MMM d, h:mm a") : ""}
                      </p>
                    </div>
                  </div>
                ))}
                {(!meetings || meetings.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground text-sm">No meetings recorded</div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
