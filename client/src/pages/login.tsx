import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function Login() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) {
      setLocation("/");
    }
  }, [user, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-1/2 bg-primary/5 -skew-y-3 transform origin-top-left z-0" />
      
      <Card className="w-full max-w-md shadow-2xl z-10 border-primary/10">
        <CardContent className="pt-10 pb-10 px-8 text-center space-y-8">
          <div>
            <h1 className="text-4xl font-display font-bold text-primary mb-2">xFunerals</h1>
            <p className="text-muted-foreground">Director Intelligence Dashboard</p>
          </div>
          
          <div className="space-y-4">
            <Button 
              className="w-full h-12 text-lg font-medium shadow-lg shadow-primary/20" 
              onClick={() => window.location.href = "/api/login"}
            >
              Log In with Replit
            </Button>
            <p className="text-xs text-muted-foreground">
              Secure access for authorized funeral directors only.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
