import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

interface WalletData {
  id: string;
  address: string;
  circleWalletId: string;
  blockchain: string;
  state: string;
}

interface AppShellProps {
  children: React.ReactNode;
  wallet: WalletData | null;
  userRole: string;
  pendingOfferCount?: number;
}

export function AppShell({ children, wallet, userRole, pendingOfferCount = 0 }: AppShellProps) {
  return (
    <div className="min-h-screen bg-arc-bg-0 flex">
      <Sidebar pendingOfferCount={pendingOfferCount} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar wallet={wallet} userRole={userRole} pendingOfferCount={pendingOfferCount} />
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  );
}
