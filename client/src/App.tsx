import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LayoutShell } from "@/components/layout-shell";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

import Dashboard from "@/pages/dashboard";
import CasesList from "@/pages/cases-list";
import CaseDetail from "@/pages/case-detail";
import Communications from "@/pages/communications";
import ChecklistSettings from "@/pages/checklist-settings";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

function PrivateRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <LayoutShell>
      <Component />
    </LayoutShell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/api/login" component={() => null} /> {/* Handled by backend, prevents 404 flash */}
      
      {/* Public Route */}
      <Route path="/login" component={Login} />

      {/* Private Routes wrapped in Layout */}
      <Route path="/">
        {() => <PrivateRoute component={Dashboard} />}
      </Route>
      <Route path="/cases">
        {() => <PrivateRoute component={CasesList} />}
      </Route>
      <Route path="/cases/:id">
        {() => <PrivateRoute component={CaseDetail} />}
      </Route>
      <Route path="/communications">
        {() => <PrivateRoute component={Communications} />}
      </Route>
      <Route path="/settings/checklists">
        {() => <PrivateRoute component={ChecklistSettings} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
