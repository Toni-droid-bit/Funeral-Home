import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export default function Login() {
  const { user, isLoading, login, isLoggingIn, loginError } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (user) setLocation("/");
  }, [user, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login({ username, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1/2 bg-primary/5 -skew-y-3 transform origin-top-left z-0" />

      <Card className="w-full max-w-md shadow-2xl z-10 border-primary/10">
        <CardContent className="pt-10 pb-10 px-8 space-y-8">
          <div className="text-center">
            <h1 className="text-4xl font-display font-bold text-primary mb-2">xFunerals</h1>
            <p className="text-muted-foreground">Director Intelligence Dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {loginError && (
              <p className="text-sm text-destructive">{loginError}</p>
            )}

            <Button
              type="submit"
              className="w-full h-12 text-lg font-medium shadow-lg shadow-primary/20"
              disabled={isLoggingIn}
            >
              {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign In"}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center">
            Secure access for authorized funeral directors only.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
