import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const bodySchema = z.object({
  jobs: z.number().int().min(0).max(500).default(0).optional(),
  channels: z.number().int().min(0).max(200).default(0).optional(),
  messagesPerChannel: z.number().int().min(0).max(50).default(0).optional(),
});

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function isMissingMessagesTable(message: string) {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes("message_channels") || normalized.includes("messages")) &&
    (normalized.includes("does not exist") || normalized.includes("not find") || normalized.includes("schema cache"))
  );
}

function isMessagesSeedConstraint(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("thread_id") ||
    normalized.includes("not-null constraint") ||
    normalized.includes("violates") ||
    normalized.includes("foreign key")
  );
}

export async function POST(request: Request) {
  if (process.env.E2E !== "true" && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsed.error.issues.map((issue: { path: Array<string | number>; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const now = Date.now();

    const jobs = parsed.data.jobs ?? 0;
    const channels = parsed.data.channels ?? 0;
    const messagesPerChannel = parsed.data.messagesPerChannel ?? 0;

    let insertedJobs = 0;
    let insertedChannels = 0;
    let insertedMessages = 0;
    let messagesTablesAvailable = true;

    if (jobs > 0) {
      const rows = Array.from({ length: jobs }, (_, i) => ({
        company_id: companyId,
        created_by: userId,
        name: `E2E Large Job ${now}-${i}`,
        status: "draft",
      }));

      for (const part of chunk(rows, 200)) {
        const { error } = await supabase.from("jobs").insert(part);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        insertedJobs += part.length;
      }
    }

    if (channels > 0) {
      const channelRows = Array.from({ length: channels }, (_, i) => ({
        company_id: companyId,
        name: `e2e-large-channel-${now}-${i}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { data: createdChannels, error: channelError } = await supabase
        .from("message_channels")
        .insert(channelRows)
        .select("id");

      if (channelError) {
        if (isMissingMessagesTable(channelError.message || "")) {
          messagesTablesAvailable = false;
        } else {
          return NextResponse.json({ error: channelError.message }, { status: 400 });
        }
      }

      insertedChannels = messagesTablesAvailable ? createdChannels?.length ?? 0 : 0;

      if (messagesTablesAvailable && (createdChannels?.length ?? 0) > 0 && messagesPerChannel > 0) {
        const messageRows = (createdChannels ?? []).flatMap((channel) =>
          Array.from({ length: messagesPerChannel }, (_, idx) => ({
            company_id: companyId,
            channel_id: channel.id,
            thread_id: channel.id,
            sender_user_id: userId,
            body: `Seeded message ${now}-${idx}`,
            created_at: new Date().toISOString(),
          }))
        );

        for (const part of chunk(messageRows, 500)) {
          let { error } = await supabase.from("messages").insert(part);
          if (error && /column .*thread_id.* does not exist|Could not find the 'thread_id' column/i.test(error.message || "")) {
            const withoutThreadId = part.map((row) => {
              const mutableRow = { ...row } as Record<string, unknown>;
              delete mutableRow.thread_id;
              return mutableRow;
            });
            const retry = await supabase.from("messages").insert(withoutThreadId);
            error = retry.error;
          }
          if (error) {
            if (isMissingMessagesTable(error.message || "") || isMessagesSeedConstraint(error.message || "")) {
              messagesTablesAvailable = false;
              insertedMessages = 0;
              break;
            }
            return NextResponse.json({ error: error.message }, { status: 400 });
          }
          insertedMessages += part.length;
        }
      }
    }

    return NextResponse.json({
      item: {
        inserted_jobs: insertedJobs,
        inserted_channels: insertedChannels,
        inserted_messages: insertedMessages,
        messages_tables_available: messagesTablesAvailable,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
