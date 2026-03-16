import { useCases } from "@/hooks/use-cases";
import { CreateCaseDialog } from "@/components/create-case-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Search, Loader2, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function CasesList() {
  const { data: cases, isLoading } = useCases();
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const filteredCases = cases?.filter(c =>
    c.deceasedName.toLowerCase().includes(search.toLowerCase()) ||
    c.status?.toLowerCase().includes(search.toLowerCase())
  );

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", "/api/cases", undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "All cases deleted", description: "All cases have been permanently deleted." });
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not delete cases.", variant: "destructive" });
    },
  });

  const handleDeleteAll = () => {
    if (!cases?.length) return;
    if (confirm(`Are you sure you want to permanently delete all ${cases.length} case(s)? This cannot be undone.`)) {
      deleteAllMutation.mutate();
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-display font-bold text-primary">Cases</h2>
          <p className="text-muted-foreground mt-1">Manage active and archived funeral cases.</p>
        </div>
        <CreateCaseDialog />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input
          placeholder="Search cases..."
          className="pl-10 max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card className="border-border/60 shadow-md overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Deceased Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Religion</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Date Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : filteredCases?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    No cases found matching your search.
                  </TableCell>
                </TableRow>
              ) : (
                filteredCases?.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => navigate(`/cases/${c.id}`)}>
                    <TableCell className="font-medium text-primary">
                      {c.deceasedName}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status || "active"} />
                    </TableCell>
                    <TableCell>{c.religion || "Secular"}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">
                        {c.language || "English"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.createdAt ? format(new Date(c.createdAt), "MMM d, yyyy") : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Delete All button at the bottom */}
      {cases && cases.length > 0 && (
        <div className="flex justify-end pt-2">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/10 gap-2"
            onClick={handleDeleteAll}
            disabled={deleteAllMutation.isPending}
          >
            {deleteAllMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Delete All Cases
          </Button>
        </div>
      )}
    </div>
  );
}
