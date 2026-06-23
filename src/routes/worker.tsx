import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ChatComponent } from "@/components/ChatComponent";
import { requireRole, signOut } from "@/lib/auth";

export const Route = createFileRoute("/worker")({
  head: () => ({
    meta: [{ title: "Worker Chat — Factory Console" }],
  }),
  beforeLoad: () => requireRole("worker"),
  component: WorkerPage,
});

function WorkerPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <div className="text-sm font-medium text-foreground">Worker Console</div>
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

      <ChatComponent />
    </div>
  );
}
