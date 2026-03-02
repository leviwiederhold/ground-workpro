import * as fs from "node:fs";
import * as path from "node:path";

type FallbackChannel = {
  id: string;
  company_id: string;
  name: string;
  member_user_ids: string[];
  created_at: string;
  updated_at: string;
};

type FallbackMessage = {
  id: string;
  company_id: string;
  channel_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
};

type FallbackStore = {
  channels: FallbackChannel[];
  messages: FallbackMessage[];
};

const fallbackFilePath = path.join("/tmp", "groundwork-fallback-messages.json");

function readStore(): FallbackStore {
  try {
    if (!fs.existsSync(fallbackFilePath)) {
      return { channels: [], messages: [] };
    }
    const raw = fs.readFileSync(fallbackFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { channels: [], messages: [] };
    }
    return {
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch {
    return { channels: [], messages: [] };
  }
}

function writeStore(store: FallbackStore) {
  try {
    fs.writeFileSync(fallbackFilePath, JSON.stringify(store), "utf8");
  } catch {
    // no-op
  }
}

export function listFallbackChannels(companyId: string, userId?: string) {
  return readStore()
    .channels.filter((row) => {
      if (row.company_id !== companyId) return false;
      if (!userId) return true;
      if (!Array.isArray(row.member_user_ids) || row.member_user_ids.length === 0) return false;
      return row.member_user_ids.includes(String(userId));
    })
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

export function createFallbackChannel(companyId: string, name: string, memberUserIds: string[] = []) {
  const store = readStore();
  const now = new Date().toISOString();
  const normalizedMemberUserIds = Array.from(new Set(memberUserIds.map((id) => String(id)).filter(Boolean)));
  const existing = store.channels.find((row) => {
    if (row.company_id !== companyId) return false;
    if (String(row.name) !== String(name)) return false;
    const rowMembers = Array.from(new Set((row.member_user_ids ?? []).map((id) => String(id)).filter(Boolean))).sort();
    const nextMembers = [...normalizedMemberUserIds].sort();
    return rowMembers.length === nextMembers.length && rowMembers.every((value, index) => value === nextMembers[index]);
  });
  if (existing) {
    return existing;
  }
  const channel: FallbackChannel = {
    id: crypto.randomUUID(),
    company_id: companyId,
    name,
    member_user_ids: normalizedMemberUserIds,
    created_at: now,
    updated_at: now,
  };
  store.channels.push(channel);
  writeStore(store);
  return channel;
}

export function getFallbackChannel(companyId: string, channelId: string) {
  return readStore().channels.find(
    (row) => row.company_id === companyId && String(row.id) === String(channelId)
  ) ?? null;
}

export function listFallbackMessages(companyId: string, channelId: string) {
  return readStore()
    .messages.filter(
      (row) =>
        row.company_id === companyId && String(row.channel_id) === String(channelId)
    )
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

export function createFallbackMessage(input: {
  companyId: string;
  channelId: string;
  senderUserId: string;
  body: string;
}) {
  const store = readStore();
  const message: FallbackMessage = {
    id: crypto.randomUUID(),
    company_id: input.companyId,
    channel_id: input.channelId,
    sender_user_id: input.senderUserId,
    body: input.body,
    created_at: new Date().toISOString(),
  };
  store.messages.push(message);
  writeStore(store);
  return message;
}
