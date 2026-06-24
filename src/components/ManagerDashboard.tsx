import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EmployeeMessage } from "@/lib/database.types";
import {
  fetchManagerMessages,
  formatMessageStatus,
  shortMessageId,
  subscribeToEmployeeMessages,
  type EmployeeMessageWithEmail,
} from "@/lib/messages";
import { supabase } from "@/lib/supabase";

const MESSAGE_PREVIEW_CHAR_LIMIT = 200;

function EmployeeMessageContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > MESSAGE_PREVIEW_CHAR_LIMIT;
  const preview = `${content.slice(0, MESSAGE_PREVIEW_CHAR_LIMIT).trimEnd()}…`;

  return (
    <div className="max-w-md space-y-1">
      <p className="whitespace-pre-wrap text-sm">{expanded || !isLong ? content : preview}</p>
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

function mergeMessage(
  current: EmployeeMessageWithEmail[],
  incoming: EmployeeMessage,
): EmployeeMessageWithEmail[] {
  if (current.some((row) => row.id === incoming.id)) {
    return current;
  }

  return [
    {
      ...incoming,
      employee_email: null,
    },
    ...current,
  ];
}

async function resolveEmployeeEmail(employeeId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("accounts")
    .select("email")
    .eq("id", employeeId)
    .maybeSingle();

  if (error && error.code !== "PGRST205") {
    return null;
  }

  return data?.email ?? null;
}

function EmployeeMessagesPanel() {
  const [messages, setMessages] = useState<EmployeeMessageWithEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetchManagerMessages()
      .then((rows) => {
        if (active) {
          setMessages(rows);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load messages.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToEmployeeMessages(
      (incoming) => {
        setMessages((current) => mergeMessage(current, incoming));

        void resolveEmployeeEmail(incoming.employee_id).then((email) => {
          if (!email) {
            return;
          }

          setMessages((current) =>
            current.map((row) =>
              row.id === incoming.id ? { ...row, employee_email: email } : row,
            ),
          );
        });
      },
      (subscriptionError) => {
        setError(subscriptionError.message);
      },
      () => {
        void fetchManagerMessages()
          .then((rows) => {
            setMessages(rows);
            setError(null);
          })
          .catch((err) => {
            setError(err instanceof Error ? err.message : "Failed to refresh messages.");
          });
      },
    );

    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Загрузка сообщений...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Сообщений от сотрудников пока нет.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">Сообщения сотрудников</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID ошибки</TableHead>
            <TableHead>Сотрудник</TableHead>
            <TableHead>Критичность</TableHead>
            <TableHead>Сообщение от работника</TableHead>
            <TableHead>Время</TableHead>
            <TableHead>План действий</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {messages.map((message) => (
            <TableRow key={message.id}>
              <TableCell className="font-mono text-xs">{shortMessageId(message.id)}</TableCell>
              <TableCell>{message.employee_email ?? message.employee_id.slice(0, 8)}</TableCell>
              <TableCell>
                <Badge variant={message.status === "pending" ? "destructive" : "secondary"}>
                  {formatMessageStatus(message.status)}
                </Badge>
              </TableCell>
              <TableCell>
                <EmployeeMessageContent content={message.content} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(message.created_at).toLocaleString()}
              </TableCell>
              <TableCell className="text-muted-foreground">—</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ManagerDashboard() {
  return <EmployeeMessagesPanel />;
}
