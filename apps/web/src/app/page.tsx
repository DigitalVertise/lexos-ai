import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { TrustStrip, HowItWorks, AiTeam, Features, Faq, FinalCta, Footer } from "@/components/landing/sections";
import { WorkspaceSection } from "@/components/landing/dashboard-preview";
import { Pricing } from "@/components/landing/pricing";

export default function Home() {
  return (
    <div className="overflow-x-clip">
      <Navbar />
      <main>
        <Hero />
        <TrustStrip />
        <HowItWorks />
        <AiTeam />
        <Features />
        <WorkspaceSection />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
