import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";

const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Auth = lazy(() => import("./pages/Auth"));
const Play = lazy(() => import("./pages/Play"));
const Room = lazy(() => import("./pages/Room"));
const LiveDebateRoom = lazy(() => import("./pages/LiveDebateRoom"));
const RoomResults = lazy(() => import("./pages/RoomResults"));
const Invite = lazy(() => import("./pages/Invite"));
const AdminMatchmaking = lazy(() => import("./pages/AdminMatchmaking"));
const Demo = lazy(() => import("./pages/Demo"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<div className="min-h-screen bg-background" />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/play" element={<Play />} />
              <Route path="/demo" element={<Demo />} />
              <Route path="/room/:id" element={<Room />} />
              <Route path="/room/:id/live" element={<LiveDebateRoom />} />
              <Route path="/room/:id/results" element={<RoomResults />} />
              <Route path="/invite/:code" element={<Invite />} />
              <Route path="/admin/matchmaking" element={<AdminMatchmaking />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
