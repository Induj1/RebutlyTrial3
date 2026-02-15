import { Sidebar } from '@/components/Sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { HeroSection } from '@/components/HeroSection';
import { StatsBar } from '@/components/StatsBar';
import { QuickActions } from '@/components/QuickActions';
import { DebateFormats } from '@/components/DebateFormats';
import { FeaturesGrid } from '@/components/FeaturesGrid';
import { PricingSection } from '@/components/PricingSection';
import { Footer } from '@/components/Footer';

const Index = () => {
  return (
    <SidebarProvider defaultOpen>
      <Sidebar />
      <SidebarInset className="flex-1 lg:ml-0 overflow-x-hidden">
        {/* Hero */}
        <HeroSection />

        {/* Dashboard-style content */}
        <div className="max-w-6xl mx-auto px-4 lg:px-8 pb-8">
          {/* Stats */}
          <StatsBar />

          {/* Quick Actions */}
          <QuickActions />

          {/* Debate Formats */}
          <DebateFormats />
        </div>

        {/* Features */}
        <FeaturesGrid />

        {/* Pricing */}
        <PricingSection />

        {/* Footer */}
        <Footer />
      </SidebarInset>
    </SidebarProvider>
  );
};

export default Index;
