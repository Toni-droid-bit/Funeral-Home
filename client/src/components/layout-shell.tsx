import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { 
  LayoutDashboard, 
  Users, 
  Phone, 
  Mic, 
  Settings, 
  LogOut, 
  Menu,
  Bell
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { 
  Sheet, 
  SheetContent, 
  SheetTrigger 
} from "@/components/ui/sheet";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { ClipboardList } from "lucide-react";

const NAVIGATION = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Cases", href: "/cases", icon: Users },
  { name: "xLink Calls", href: "/calls", icon: Phone },
  { name: "xScribe Meetings", href: "/meetings", icon: Mic },
];

const SETTINGS_NAVIGATION = [
  { name: "Checklist Settings", href: "/settings/checklists", icon: ClipboardList },
];

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const NavContent = () => (
    <div className="flex flex-col h-full bg-primary text-primary-foreground">
      <div className="p-6 border-b border-primary-foreground/10">
        <h1 className="text-2xl font-display font-bold text-secondary">xFunerals</h1>
        <p className="text-xs text-primary-foreground/60 mt-1">Director Dashboard</p>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {NAVIGATION.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href}>
              <div
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                  isActive
                    ? "bg-primary-foreground/10 text-white shadow-lg shadow-black/10"
                    : "text-primary-foreground/60 hover:text-white hover:bg-primary-foreground/5"
                }`}
              >
                <item.icon className={`w-5 h-5 ${isActive ? "text-secondary" : ""}`} />
                {item.name}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-primary-foreground/10">
        <p className="px-4 py-2 text-xs text-primary-foreground/40 uppercase tracking-wider">Settings</p>
        {SETTINGS_NAVIGATION.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href}>
              <div
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                  isActive
                    ? "bg-primary-foreground/10 text-white shadow-lg shadow-black/10"
                    : "text-primary-foreground/60 hover:text-white hover:bg-primary-foreground/5"
                }`}
                data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <item.icon className={`w-5 h-5 ${isActive ? "text-secondary" : ""}`} />
                {item.name}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block w-72 fixed inset-y-0 z-50">
        <NavContent />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 lg:ml-72 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border/50 h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center lg:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="-ml-2">
                  <Menu className="w-6 h-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72 border-r-0">
                <NavContent />
              </SheetContent>
            </Sheet>
            <span className="ml-4 font-display font-bold text-xl text-primary">xFunerals</span>
          </div>

          <div className="flex-1" /> {/* Spacer */}

          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <Bell className="w-5 h-5" />
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                  <Avatar>
                    <AvatarImage src={user?.profileImageUrl ?? undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {user?.firstName?.[0] || "U"}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuItem className="flex flex-col items-start gap-1 p-2">
                  <p className="text-sm font-medium">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => logout()}
                  className="text-destructive focus:text-destructive cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto animate-in fade-in duration-500">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
