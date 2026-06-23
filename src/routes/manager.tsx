import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ManagerDashboard } from "@/components/ManagerDashboard";
import { requireRole, signOut } from "@/lib/auth";

export const Route = createFileRoute("/manager")({
  head: () => ({
    meta: [{ title: "Error Logs — Factory Console" }],
  }),
  beforeLoad: () => requireRole("manager"),
  component: ManagerPage,
});

function ManagerPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <div className="text-sm font-medium text-foreground">Manager Console</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await signOut();
            navigate({ to: "/" });
          }}
        >
          Sign out
        </Button>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        <ManagerDashboard />
      </main>
    </div>
  );
}
