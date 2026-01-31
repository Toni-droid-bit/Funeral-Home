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
import { StatusBadge } from "@/components/status-badge";
import { Search, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { Link } from "wouter";

export default function CasesList() {
  const { data: cases, isLoading } = useCases();
  const [search, setSearch] = useState("");

  const filteredCases = cases?.filter(c => 
    c.deceasedName.toLowerCase().includes(search.toLowerCase()) ||
    c.status?.toLowerCase().includes(search.toLowerCase())
  );

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
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30 transition-colors">
                    <TableCell className="font-medium text-primary">
                      <Link href={`/cases/${c.id}`} className="hover:underline">
                        {c.deceasedName}
                      </Link>
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
    </div>
  );
}
