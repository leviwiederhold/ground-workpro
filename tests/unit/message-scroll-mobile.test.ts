import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  countNewMessages,
  isNearMessageBottom,
  scrollTopAfterHistoryPrepend,
} from "../../src/lib/messages/scroll.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("near-bottom detection distinguishes live following from intentional history reading", () => {
  assert.equal(
    isNearMessageBottom({ scrollTop: 904, scrollHeight: 1500, clientHeight: 500 }),
    true
  );
  assert.equal(
    isNearMessageBottom({ scrollTop: 500, scrollHeight: 1500, clientHeight: 500 }),
    false
  );
});

test("prepending historical messages preserves the visible scroll anchor", () => {
  assert.equal(
    scrollTopAfterHistoryPrepend({
      previousScrollTop: 180,
      previousScrollHeight: 1200,
      nextScrollHeight: 1850,
    }),
    830
  );
});

test("new-message counting ignores refreshed copies of existing messages", () => {
  assert.equal(
    countNewMessages(
      [{ id: "one" }, { id: "two" }],
      [{ id: "one" }, { id: "two" }, { id: "three" }, { id: "four" }]
    ),
    2
  );
});

test("message API pages from newest while returning chronological rows", () => {
  const domain = readFileSync(join(repoRoot, "src/lib/messages/mvp.ts"), "utf8");
  const route = readFileSync(
    join(repoRoot, "app/api/messages/threads/[id]/messages/route.ts"),
    "utf8"
  );

  assert.match(domain, /order\("created_at", \{ ascending: false \}\)/);
  assert.match(domain, /items: \(\(result\.data \?\? \[\]\)[\s\S]*\.reverse\(\)/);
  assert.match(route, /defaultPageSize: 100/);
});

test("conversation open, switch, send, receive, and history each use the intended scroll mode", () => {
  const view = readFileSync(join(repoRoot, "app/components/views/MessagesView.tsx"), "utf8");

  assert.match(view, /loadMessages\(activeChannelId, \{ mode: 'initial', page: 1 \}\)/);
  assert.match(view, /pendingScrollActionRef\.current = 'initial'/);
  assert.match(view, /scrollNode\.scrollTop = scrollNode\.scrollHeight/);
  assert.match(view, /window\.requestAnimationFrame\(scrollToBottom\)/);
  assert.match(view, /pendingScrollActionRef\.current = 'send'/);
  assert.match(view, /isNearMessageBottom\(scrollNode\)[\s\S]*pendingScrollActionRef\.current = 'receive'/);
  assert.match(view, /setNewMessagesBelow\(\(count\) => count \+ addedCount\)/);
  assert.match(view, /data-testid="messages-jump-to-bottom"/);
  assert.match(view, /previousScrollHeight: scrollNode\.scrollHeight/);
  assert.match(view, /scrollTopAfterHistoryPrepend/);
  assert.match(view, /data-testid="messages-load-older"/);
});

test("mobile messages is a full-height list-to-thread layout with keyboard and safe-area handling", () => {
  const view = readFileSync(join(repoRoot, "app/components/views/MessagesView.tsx"), "utf8");

  assert.match(view, /window\.visualViewport\?\.addEventListener\('resize', update\)/);
  assert.match(view, /--messages-mobile-height/);
  assert.match(view, /fixed inset-x-0[\s\S]*md:relative/);
  assert.match(view, /showConversationPanel \? 'hidden md:flex' : 'flex'/);
  assert.match(view, /setActiveChannel\(null\)[\s\S]*setPendingDirectContact\(null\)/);
  assert.match(view, /data-testid="messages-thread-header"/);
  assert.match(view, /data-testid="messages-composer"/);
  assert.match(view, /pb-\[calc\(0\.75rem\+var\(--mobile-safe-bottom\)\)\]/);
  assert.match(view, /overscroll-contain/);
});

test("every active composer uses the simplified placeholder", () => {
  const view = readFileSync(join(repoRoot, "app/components/views/MessagesView.tsx"), "utf8");
  const placeholders = view.match(/placeholder="Send message"/g) ?? [];

  assert.equal(placeholders.length, 2);
  assert.doesNotMatch(view, /Send a message to everyone|Message #|placeholder=\{`Message/);
});
