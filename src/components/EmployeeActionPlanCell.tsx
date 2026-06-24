import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ActionPlanStatus } from "@/lib/database.types";
import { isWorkerPdfMessage } from "@/lib/worker-attachments";

const ACTION_PLAN_PREVIEW_CHAR_LIMIT = 240;

type EmployeeActionPlanCellProps = {
  content: string;
  actionPlan: string | null;
  actionPlanStatus: ActionPlanStatus;
};

export function EmployeeActionPlanCell({
  content,
  actionPlan,
  actionPlanStatus,
}: EmployeeActionPlanCellProps) {
  const [expanded, setExpanded] = useState(false);

  if (!isWorkerPdfMessage(content)) {
    return <span className="text-muted-foreground">—</span>;
  }

  if (actionPlanStatus === "generating") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Генерация...
      </div>
    );
  }

  if (actionPlanStatus === "failed") {
    return <span className="text-sm text-destructive">Не удалось сгенерировать план</span>;
  }

  if (actionPlanStatus === "ready" && actionPlan) {
    const isLong = actionPlan.length > ACTION_PLAN_PREVIEW_CHAR_LIMIT;
    const preview = `${actionPlan.slice(0, ACTION_PLAN_PREVIEW_CHAR_LIMIT).trimEnd()}…`;

    return (
      <div className="max-w-md space-y-1">
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {expanded || !isLong ? actionPlan : preview}
        </p>
        {isLong ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-primary"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Свернуть" : "Показать полностью"}
          </Button>
        ) : null}
      </div>
    );
  }

  return <span className="text-sm text-muted-foreground">Ожидание...</span>;
}
