/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @next/next/no-img-element */
// @ts-nocheck
'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { MobileSheet } from '@/app/components/ui/MobileSheet';
import {
  ACTIVE_MESSAGE_THREAD_KEY,
  PENDING_MESSAGE_THREAD_KEY,
} from '@/lib/push/navigation';
import { MESSAGE_PUSH_RECEIVED_EVENT } from '@/lib/push/client';
import { validateAttachmentMetadata } from '@/lib/attachments/security';
import {
  MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES,
  MAX_STANDARD_MESSAGE_ATTACHMENT_BYTES,
  MAX_VIDEO_ATTACHMENT_BYTES,
  MESSAGE_ATTACHMENT_SIZE_LIMIT_MIB,
  VIDEO_ATTACHMENT_EXTENSIONS,
  inferVideoAttachmentContentType,
  isVideoAttachmentContentType,
  validateVideoAttachmentPolicy,
} from '@/lib/messages/attachmentPolicy';
import { readVideoDurationSeconds, uploadAttachmentWithProgress } from '@/lib/messages/videoClient';
import {
  countNewMessages,
  isNearMessageBottom,
  scrollTopAfterHistoryPrepend,
} from '@/lib/messages/scroll';

const hasRecordId = (value) => {
  const id = value?.id;
  return id !== null && id !== undefined && String(id).trim() !== '';
};

const hasUserId = (value) => {
  const userId = value?.userId;
  return userId !== null && userId !== undefined && String(userId).trim() !== '';
};

export function MessagesView({ employees = [], availableUsersSeed = [], ui }) {
  const { Button, Icon } = ui;
  const [activeChannel, setActiveChannel] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [channels, setChannels] = useState([]);
  const [messages, setMessages] = useState([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState('');
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [invalidChannelIds, setInvalidChannelIds] = useState([]);
  const [createChannelLoading, setCreateChannelLoading] = useState(false);
  const [createChannelError, setCreateChannelError] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState('');
  const [availableUsers, setAvailableUsers] = useState(() => (Array.isArray(availableUsersSeed) ? availableUsersSeed.filter(hasUserId) : []));
  const [selectedNewChatUsers, setSelectedNewChatUsers] = useState([]);
  const [showMembers, setShowMembers] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [msgMenuOpenId, setMsgMenuOpenId] = useState('');
  const [editingMsgId, setEditingMsgId] = useState('');
  const [editingText, setEditingText] = useState('');
  const [msgActionError, setMsgActionError] = useState('');
  const [members, setMembers] = useState([]);
  const [membersError, setMembersError] = useState('');
  const [selectedAddMembers, setSelectedAddMembers] = useState([]);
  const [myUserId, setMyUserId] = useState('');
  const [newIncomingCount, setNewIncomingCount] = useState(0);
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const [messagesPage, setMessagesPage] = useState(1);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [pendingDirectContact, setPendingDirectContact] = useState(null);
  const [forcedDirectLabels, setForcedDirectLabels] = useState({});
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [viewportReady, setViewportReady] = useState(false);
  const [mobileViewportStyle, setMobileViewportStyle] = useState({});
  // Company-wide chat naming
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [showNameModal, setShowNameModal] = useState(false);
  const [teamChatName, setTeamChatName] = useState('');
  const [namingSaving, setNamingSaving] = useState(false);
  const [namingError, setNamingError] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [attachmentPreparing, setAttachmentPreparing] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesScrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const previousUnreadRef = useRef(0);
  const channelsRef = useRef([]);
  const resolvedDirectChannelIdsRef = useRef(new Set());
  const activeChannelIdRef = useRef('');
  const messagesRef = useRef([]);
  const messagesPageRef = useRef(1);
  const pendingScrollActionRef = useRef('');
  const prependScrollSnapshotRef = useRef(null);
  const uploadAbortControllersRef = useRef(new Map());
  const pendingAttachmentsRef = useRef([]);
  const attachmentContextRef = useRef({ channelId: '', contactId: '' });
  const safeEmployees = useMemo(
    () => (Array.isArray(employees) ? employees.filter(hasRecordId) : []),
    [employees]
  );

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    messagesPageRef.current = messagesPage;
  }, [messagesPage]);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  // Clear any composed attachments when switching threads so files are never
  // sent to the wrong conversation. Completed-but-unlinked objects are deleted;
  // active TUS uploads are terminated so partial chunks do not linger.
  useEffect(() => {
    const previousContext = attachmentContextRef.current;
    const nextContext = {
      channelId: String(activeChannel?.id || ''),
      contactId: String(pendingDirectContact?.userId || ''),
    };
    attachmentContextRef.current = nextContext;
    if (
      previousContext.channelId === nextContext.channelId &&
      previousContext.contactId === nextContext.contactId
    ) return;

    setPendingAttachments((prev) => {
      const paths = prev.map((item) => String(item.upload?.path || '')).filter(Boolean);
      prev.forEach((item) => {
        uploadAbortControllersRef.current.get(item.id)?.abort();
        uploadAbortControllersRef.current.delete(item.id);
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      if (previousContext.channelId && paths.length > 0) {
        void fetch(`/api/messages/threads/${previousContext.channelId}/attachments/sign`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
          keepalive: true,
        }).catch(() => null);
      }
      return [];
    });
  }, [activeChannel?.id, pendingDirectContact?.userId]);

  useEffect(() => {
    const discardAbandonedUploads = () => {
      const channelId = attachmentContextRef.current.channelId;
      const paths = pendingAttachmentsRef.current
        .map((item) => String(item.upload?.path || ''))
        .filter(Boolean);
      uploadAbortControllersRef.current.forEach((controller) => controller.abort());
      if (!channelId || paths.length === 0) return;
      void fetch(`/api/messages/threads/${channelId}/attachments/sign`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
        keepalive: true,
      }).catch(() => null);
    };
    window.addEventListener('pagehide', discardAbandonedUploads);
    return () => window.removeEventListener('pagehide', discardAbandonedUploads);
  }, []);

  useEffect(() => {
    if (!Array.isArray(availableUsersSeed) || availableUsersSeed.length === 0) return;
    setAvailableUsers((current) => (current.length > 0 ? current : availableUsersSeed.filter(hasUserId)));
  }, [availableUsersSeed]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => {
      const mobile = media.matches;
      setIsMobileViewport(mobile);
      setViewportReady(true);
      if (!mobile) {
        setMobileViewportStyle({});
        return;
      }
      const viewport = window.visualViewport;
      const header = document.querySelector('[data-testid="dashboard-header"]');
      const headerBottom = Math.max(0, Math.round(header?.getBoundingClientRect?.().bottom || 0));
      const viewportBottom = Math.round((viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight));
      setMobileViewportStyle({
        '--messages-mobile-top': `${headerBottom}px`,
        '--messages-mobile-height': `${Math.max(280, viewportBottom - headerBottom)}px`,
      });
    };
    update();
    media.addEventListener('change', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      media.removeEventListener('change', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  const activeChannelId = String(activeChannel?.id || '');
  activeChannelIdRef.current = activeChannelId;

  const normalized = (value) => String(value || '').trim().toLowerCase();
  const initialsForName = useCallback((value) => {
    return String(value || '')
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'TM';
  }, []);
  const formatMessageTime = useCallback((value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }, []);
  const formatThreadSubtextTime = useCallback((value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }, []);
  const formatMessageDayLabel = useCallback((value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }, []);
  const getMessageDayKey = useCallback((value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }, []);
  const looksLikeDmName = useCallback(
    (value) => normalized(value).startsWith('dm-') || normalized(value) === 'direct message',
    []
  );
  const isDirectChannel = useCallback(
    (channel) => String(channel?.kind || '') === 'direct' || Boolean(channel?.other_user_id),
    []
  );
  const isGenericDirectLabel = useCallback((value) => {
    const name = normalized(value);
    return !name || name === 'direct message' || name === 'team member' || name.startsWith('dm-');
  }, []);
  const resolveBestName = useCallback((candidate) => {
    const fullName = String(candidate?.full_name ?? '').trim();
    if (fullName) return fullName;
    const displayName = String(candidate?.display_name ?? candidate?.name ?? candidate?.displayName ?? '').trim();
    if (displayName && normalized(displayName) !== 'team member') return displayName;
    const email = String(candidate?.email ?? '').trim();
    if (email) return email;
    const fallbackDisplayName = String(candidate?.displayName ?? '').trim();
    if (fallbackDisplayName) return fallbackDisplayName;
    return 'Team Member';
  }, []);

  const contactOptions = useMemo(() => {
    const userById = new Map((availableUsers || []).map((user) => [String(user.userId), user]));
    const options = [];

    for (const employee of safeEmployees) {
      const explicitUserId = employee?.user_id ? String(employee.user_id) : null;
      if (explicitUserId && myUserId && explicitUserId === myUserId) continue;
      const matchedUser = explicitUserId ? userById.get(explicitUserId) : null;
      const preferredLabel = resolveBestName({
        full_name: employee?.full_name,
        display_name: employee?.display_name ?? employee?.name,
        email: employee?.email,
        displayName: matchedUser?.displayName,
      });
      const preferredRole = matchedUser?.role || employee?.role || "";
      options.push({
        key: explicitUserId ? `user:${explicitUserId}` : `employee:${employee.id}`,
        label: String(preferredLabel),
        subtitle: String(preferredRole),
        userId: explicitUserId || null,
        hasAccount: Boolean(matchedUser || explicitUserId),
        avatarUrl: String(matchedUser?.avatarUrl ?? employee?.avatarUrl ?? ''),
      });
    }

    for (const user of availableUsers || []) {
      if (myUserId && String(user.userId) === myUserId) continue;
      const key = `user:${user.userId}`;
      if (options.some((item) => item.key === key)) continue;
      options.push({
        key,
        label: resolveBestName({
          displayName: user.displayName,
          email: user.email,
        }),
        subtitle: String(user.role || ''),
        userId: String(user.userId),
        hasAccount: true,
        avatarUrl: String(user.avatarUrl || ''),
      });
    }

    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [availableUsers, myUserId, resolveBestName, safeEmployees]);

  const userDisplayNameById = useMemo(
    () =>
      new Map((availableUsers || []).map((user) => [
        String(user.userId),
        resolveBestName({ displayName: user.displayName, email: user.email }),
      ])),
    [availableUsers, resolveBestName]
  );
  const userAvatarById = useMemo(
    () =>
      new Map((availableUsers || []).map((user) => [String(user.userId), String(user.avatarUrl || '')])),
    [availableUsers]
  );
  const isGroupChannel = useCallback(
    (channel) => String(channel?.kind || '') === 'group',
    []
  );
  const contactDisplayNameByUserId = useMemo(() => {
    const map = new Map();
    for (const contact of contactOptions) {
      if (!contact.userId) continue;
      if (!map.has(String(contact.userId))) {
        map.set(String(contact.userId), String(contact.label || 'Team Member'));
      }
    }
    return map;
  }, [contactOptions]);

  const getChannelDisplayName = useCallback(
    (channel) => {
      if (!channel) return 'Direct Message';
      // Companywide chat name is ALWAYS the custom thread name, else the company
      // name. It is never a sender/member-derived label, and it ignores any
      // forcedDirectLabels override (which only applies to direct chats).
      if (channel.is_companywide) {
        const cwName = String(channel.name || '').trim();
        return cwName || String(companyName || '').trim() || 'Company Chat';
      }
      const forcedLabel = forcedDirectLabels[String(channel.id || '')];
      if (forcedLabel) return String(forcedLabel);
      if (isGroupChannel(channel)) {
        if (channel.name === null || channel.name === undefined) return 'Group Chat';
        return String(channel.name);
      }
      if (!isDirectChannel(channel)) return String(channel.name || '');
      const otherUserId = String(channel.other_user_id || '');
      if (otherUserId && userDisplayNameById.has(otherUserId)) {
        return String(userDisplayNameById.get(otherUserId));
      }
      if (otherUserId && contactDisplayNameByUserId.has(otherUserId)) {
        return String(contactDisplayNameByUserId.get(otherUserId));
      }
      const fallbackName = String(channel.name || '').trim();
      if (fallbackName && !looksLikeDmName(fallbackName)) return fallbackName;
      return 'Team Member';
    },
    [forcedDirectLabels, companyName, isGroupChannel, isDirectChannel, userDisplayNameById, contactDisplayNameByUserId, looksLikeDmName]
  );

  const loadUsers = useCallback(async () => {
    const response = await fetch('/api/company-members?excludeSelf=1', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || 'Failed to load team members');
    setAvailableUsers(Array.isArray(payload?.items) ? payload.items.filter(hasUserId) : []);
  }, []);

  const loadChannels = useCallback(async (silent = false) => {
    try {
      if (!silent) setChannelsLoading(true);
      setChannelsError('');
      const response = await fetch('/api/messages/inbox', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to load channels');
      const nextChannels = Array.isArray(payload?.items) ? payload.items.filter(hasRecordId) : [];
      setChannels(nextChannels);
      setViewerIsAdmin(Boolean(payload?.viewer_is_admin));
      setCompanyName(String(payload?.company_name || ''));
      setActiveChannel((prev) => {
        if (!prev) return null;
        if (invalidChannelIds.includes(String(prev.id))) return null;
        const refreshed = nextChannels.find((c) => String(c.id) === String(prev.id));
        return refreshed || null;
      });
      const totalUnread = nextChannels.reduce(
        (sum, channel) => sum + Number(channel.unread_count || 0),
        0
      );
      if (
        previousUnreadRef.current > 0 &&
        totalUnread > previousUnreadRef.current
      ) {
        setNewIncomingCount((count) => count + (totalUnread - previousUnreadRef.current));
      }
      previousUnreadRef.current = totalUnread;
      return nextChannels;
    } catch (error) {
      setChannelsError(error instanceof Error ? error.message : 'Failed to load channels');
      return channelsRef.current;
    } finally {
      if (!silent) setChannelsLoading(false);
    }
  }, [invalidChannelIds]);

  const markThreadRead = useCallback(async (channelId) => {
    if (!channelId) return;
    await fetch(`/api/messages/threads/${channelId}/read`, { method: 'POST' }).catch(() => null);
  }, []);

  const loadMessages = useCallback(async (channelId, options = {}) => {
    const mode = options.mode || 'initial';
    const requestedPage = Number(options.page || 1);
    try {
      if (mode === 'older') setOlderMessagesLoading(true);
      if (mode === 'initial') setMessagesLoading(true);
      setMessagesError('');
      const response = await fetch(
        `/api/messages/threads/${channelId}/messages?page=${requestedPage}&pageSize=50`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to load messages');
      if (String(channelId) !== activeChannelIdRef.current) return;

      const pageItems = Array.isArray(payload?.items) ? payload.items.filter(hasRecordId) : [];
      const totalPages = Number(payload?.totalPages || 0);
      const loadedPage = mode === 'refresh' ? messagesPageRef.current : requestedPage;
      setHasOlderMessages(loadedPage < totalPages);
      if (mode !== 'refresh') setMessagesPage(requestedPage);

      if (mode === 'older') {
        const scrollNode = messagesScrollRef.current;
        prependScrollSnapshotRef.current = scrollNode
          ? { previousScrollTop: scrollNode.scrollTop, previousScrollHeight: scrollNode.scrollHeight }
          : null;
        pendingScrollActionRef.current = 'prepend';
        setMessages((previous) => {
          const ids = new Set(previous.map((item) => String(item.id)));
          return [...pageItems.filter((item) => !ids.has(String(item.id))), ...previous];
        });
      } else if (mode === 'refresh') {
        const previous = messagesRef.current;
        const previousIds = new Set(previous.map((item) => String(item.id)));
        const merged = [
          ...previous,
          ...pageItems.filter((item) => !previousIds.has(String(item.id))),
        ].sort((left, right) => {
          const timeDifference = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
          return timeDifference || String(left.id).localeCompare(String(right.id));
        });
        const addedCount = countNewMessages(previous, merged);
        if (addedCount > 0) {
          const scrollNode = messagesScrollRef.current;
          if (!scrollNode || isNearMessageBottom(scrollNode)) {
            pendingScrollActionRef.current = 'receive';
            setNewMessagesBelow(0);
          } else {
            setNewMessagesBelow((count) => count + addedCount);
          }
        }
        setMessages(merged);
      } else {
        pendingScrollActionRef.current = 'initial';
        setNewMessagesBelow(0);
        setMessages(pageItems);
      }
      if (mode !== 'refresh' || isNearMessageBottom(messagesScrollRef.current || {
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
      })) {
        await markThreadRead(channelId);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load messages';
      if (String(errorMessage).toLowerCase().includes('channel not found')) {
        setInvalidChannelIds((prev) => (
          prev.includes(String(channelId)) ? prev : [...prev, String(channelId)]
        ));
        setChannels((prev) => prev.filter((channel) => String(channel.id) !== String(channelId)));
        setActiveChannel((prev) => (prev && String(prev.id) === String(channelId) ? null : prev));
        setMessagesError('');
        return;
      }
      if (mode === 'initial') setMessages([]);
      setMessagesError(errorMessage);
    } finally {
      if (mode === 'older') setOlderMessagesLoading(false);
      if (mode === 'initial') setMessagesLoading(false);
    }
  }, [markThreadRead]);

  const loadMembers = useCallback(async (channelId) => {
    try {
      setMembersError('');
      const response = await fetch(`/api/messages/channels/${channelId}/members`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to load members');
      setMembers(Array.isArray(payload?.items) ? payload.items.filter(hasRecordId) : []);
    } catch (error) {
      setMembers([]);
      setMembersError(error instanceof Error ? error.message : 'Failed to load members');
    }
  }, []);

  useEffect(() => {
    if (!myUserId) return;
    const candidates = (channels || []).filter(
      (channel) =>
        isDirectChannel(channel) &&
        (!channel.other_user_id || isGenericDirectLabel(channel.name)) &&
        !resolvedDirectChannelIdsRef.current.has(String(channel.id))
    );
    if (candidates.length === 0) return;

    let cancelled = false;
    const resolve = async () => {
      const updates = await Promise.all(
        candidates.map(async (channel) => {
          const response = await fetch(`/api/messages/channels/${channel.id}/members`, { cache: 'no-store' }).catch(() => null);
          if (!response || !response.ok) return null;
          const payload = await response.json().catch(() => ({}));
          const members = Array.isArray(payload?.items) ? payload.items : [];
          const other = members.find((member) => String(member.userId || '') !== String(myUserId));
          if (!other?.userId) return null;
          const resolvedName =
            userDisplayNameById.get(String(other.userId)) ||
            String(other.displayName || '').trim() ||
            String(channel.name || '').trim();
          if (!resolvedName) return null;
          return {
            id: String(channel.id),
            otherUserId: String(other.userId),
            name: resolvedName,
          };
        })
      );

      if (cancelled) return;
      const byId = new Map(updates.filter(Boolean).map((update) => [String(update.id), update]));
      if (byId.size === 0) return;
      byId.forEach((_, id) => {
        resolvedDirectChannelIdsRef.current.add(String(id));
      });
      setChannels((prev) =>
        prev.map((channel) => {
          const patch = byId.get(String(channel.id));
          if (!patch) return channel;
          return {
            ...channel,
            other_user_id: patch.otherUserId,
            name: patch.name,
          };
        })
      );
      setForcedDirectLabels((prev) => {
        const next = { ...prev };
        byId.forEach((patch, id) => {
          next[String(id)] = String(patch.name);
        });
        return next;
      });
    };
    resolve();
    return () => {
      cancelled = true;
    };
  }, [channels, isDirectChannel, isGenericDirectLabel, myUserId, userDisplayNameById]);

  useEffect(() => {
    supabaseBrowser().auth.getUser().then(({ data }) => {
      setMyUserId(String(data?.user?.id || ''));
    }).catch(() => setMyUserId(''));
  }, []);

  useEffect(() => {
    loadChannels();
    if ((availableUsersSeed || []).length === 0) {
      loadUsers().catch(() => setAvailableUsers([]));
    }
  }, [availableUsersSeed, loadChannels, loadUsers]);

  const didDefaultSelectRef = useRef(false);
  const didResolvePushThreadRef = useRef(false);

  // Resolve a notification target before applying the normal Companywide-chat
  // default. The localStorage value is a cold-start fallback for Capacitor.
  useEffect(() => {
    if (didResolvePushThreadRef.current || channels.length === 0) return;
    let targetThreadId = '';
    try {
      const queryThread = new URLSearchParams(window.location.search).get('thread');
      targetThreadId = String(queryThread || window.localStorage.getItem(PENDING_MESSAGE_THREAD_KEY) || '');
    } catch {
      targetThreadId = '';
    }
    didResolvePushThreadRef.current = true;
    if (!targetThreadId) return;
    const target = channels.find((channel) => String(channel?.id || '') === targetThreadId);
    try { window.localStorage.removeItem(PENDING_MESSAGE_THREAD_KEY); } catch { /* ignore */ }
    if (!target) return;
    didDefaultSelectRef.current = true;
    setActiveChannel(target);
    window.history.replaceState({}, '', '/messages');
  }, [channels]);

  // Desktop retains the permanent Companywide default. Mobile opens on the
  // conversation list unless a push notification targeted an exact thread.
  useEffect(() => {
    if (!viewportReady) return;
    if (!didResolvePushThreadRef.current && channels.length > 0) return;
    if (didDefaultSelectRef.current) return;
    if (activeChannel) {
      didDefaultSelectRef.current = true;
      return;
    }
    if (isMobileViewport) {
      didDefaultSelectRef.current = true;
      return;
    }
    const companywide = (channels || []).find((c) => c && c.is_companywide);
    if (companywide) {
      didDefaultSelectRef.current = true;
      setActiveChannel(companywide);
    }
  }, [channels, activeChannel, isMobileViewport, viewportReady]);

  useEffect(() => {
    try {
      if (activeChannelId) window.localStorage.setItem(ACTIVE_MESSAGE_THREAD_KEY, activeChannelId);
      else window.localStorage.removeItem(ACTIVE_MESSAGE_THREAD_KEY);
    } catch { /* ignore */ }
    return () => {
      try {
        if (window.localStorage.getItem(ACTIVE_MESSAGE_THREAD_KEY) === activeChannelId) {
          window.localStorage.removeItem(ACTIVE_MESSAGE_THREAD_KEY);
        }
      } catch { /* ignore */ }
    };
  }, [activeChannelId]);

  // First open by an owner of an UNNAMED company-wide chat -> prompt to name it.
  // Shows once per chat (until named or explicitly dismissed this device).
  const didNamePromptRef = useRef(false);
  useEffect(() => {
    if (didNamePromptRef.current) return;
    const companywide = (channels || []).find((c) => c && c.is_companywide);
    if (!companywide || !viewerIsAdmin || !companywide.needs_naming) return;
    let dismissed = false;
    try { dismissed = window.localStorage.getItem(`gw_companywide_named_prompt_${companywide.id}`) === '1'; } catch { /* ignore */ }
    if (dismissed) return;
    didNamePromptRef.current = true;
    setTeamChatName('');
    setNamingError('');
    setShowNameModal(true);
  }, [channels, viewerIsAdmin]);

  const companywideChannel = useMemo(
    () => (channels || []).find((c) => c && c.is_companywide) || null,
    [channels]
  );

  const saveTeamChatName = useCallback(async () => {
    const name = String(teamChatName || '').trim();
    if (!name) { setNamingError('Enter a name for your team chat.'); return; }
    setNamingSaving(true);
    setNamingError('');
    try {
      const res = await fetch('/api/messages/companywide', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) { setNamingError(payload?.error || 'Failed to save name.'); return; }
      const savedName = String(payload?.item?.name || name).trim();
      setActiveChannel((prev) => (
        prev && prev.is_companywide
          ? { ...prev, name: savedName, needs_naming: false }
          : prev
      ));
      setChannels((prev) =>
        prev.map((channel) =>
          channel?.is_companywide
            ? { ...channel, name: savedName, needs_naming: false }
            : channel
        )
      );
      try { if (companywideChannel) window.localStorage.setItem(`gw_companywide_named_prompt_${companywideChannel.id}`, '1'); } catch { /* ignore */ }
      setShowNameModal(false);
      await loadChannels(true);
    } catch {
      setNamingError('Failed to save name.');
    } finally {
      setNamingSaving(false);
    }
  }, [teamChatName, companywideChannel, loadChannels]);

  const dismissNamePrompt = useCallback(() => {
    try { if (companywideChannel) window.localStorage.setItem(`gw_companywide_named_prompt_${companywideChannel.id}`, '1'); } catch { /* ignore */ }
    setShowNameModal(false);
  }, [companywideChannel]);

  const openRenameTeamChat = useCallback(() => {
    setTeamChatName(String(companywideChannel?.name || ''));
    setNamingError('');
    setShowNameModal(true);
  }, [companywideChannel]);

  useEffect(() => {
    const refreshInbox = () => {
      if (typeof document === 'undefined' || document.hidden) return;
      loadChannels(true);
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', refreshInbox);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', refreshInbox);
      }
    };
  }, [loadChannels]);

  useEffect(() => {
    const refreshFromPush = (event) => {
      const threadId = String(event?.detail?.threadId || '');
      void loadChannels(true);
      if (threadId && threadId === activeChannelId) {
        void loadMessages(threadId, { mode: 'refresh', page: 1 });
      }
    };
    window.addEventListener(MESSAGE_PUSH_RECEIVED_EVENT, refreshFromPush);
    return () => window.removeEventListener(MESSAGE_PUSH_RECEIVED_EVENT, refreshFromPush);
  }, [activeChannelId, loadChannels, loadMessages]);

  useEffect(() => {
    if (!activeChannelId) {
      setMessages([]);
      setMembers([]);
      return;
    }
    if (invalidChannelIds.includes(activeChannelId)) {
      setActiveChannel(null);
      return;
    }
    setNewIncomingCount(0);
    setMessages([]);
    setMessagesPage(1);
    setHasOlderMessages(false);
    setNewMessagesBelow(0);
    pendingScrollActionRef.current = 'initial';
    loadMessages(activeChannelId, { mode: 'initial', page: 1 });
  }, [activeChannelId, invalidChannelIds, loadMessages]);

  useEffect(() => {
    if (!showMembers || !activeChannelId) return;
    loadMembers(activeChannelId);
  }, [showMembers, activeChannelId, loadMembers]);

  useLayoutEffect(() => {
    const scrollNode = messagesScrollRef.current;
    const action = pendingScrollActionRef.current;
    if (!scrollNode || !action) return;

    if (action === 'prepend') {
      const snapshot = prependScrollSnapshotRef.current;
      if (snapshot) {
        scrollNode.scrollTop = scrollTopAfterHistoryPrepend({
          ...snapshot,
          nextScrollHeight: scrollNode.scrollHeight,
        });
      }
      prependScrollSnapshotRef.current = null;
    } else {
      const scrollToBottom = () => {
        if (action === 'initial') {
          scrollNode.scrollTop = scrollNode.scrollHeight;
        } else {
          scrollNode.scrollTo({ top: scrollNode.scrollHeight, behavior: 'smooth' });
        }
      };
      scrollToBottom();
      // Run once after paint as well. Mobile font/layout settlement can increase
      // scrollHeight after the layout effect, which otherwise leaves first open
      // at the top even though the latest page was fetched.
      window.requestAnimationFrame(scrollToBottom);
    }
    pendingScrollActionRef.current = '';
  }, [messages, activeChannelId]);

  const handleMessagesScroll = useCallback(() => {
    const scrollNode = messagesScrollRef.current;
    if (scrollNode && isNearMessageBottom(scrollNode)) setNewMessagesBelow(0);
  }, []);

  const jumpToLatestMessage = useCallback(() => {
    const scrollNode = messagesScrollRef.current;
    if (!scrollNode) return;
    scrollNode.scrollTo({ top: scrollNode.scrollHeight, behavior: 'smooth' });
    setNewMessagesBelow(0);
    if (activeChannelIdRef.current) void markThreadRead(activeChannelIdRef.current);
  }, [markThreadRead]);

  const loadOlderMessages = useCallback(() => {
    if (!activeChannelIdRef.current || olderMessagesLoading || !hasOlderMessages) return;
    void loadMessages(activeChannelIdRef.current, {
      mode: 'older',
      page: messagesPageRef.current + 1,
    });
  }, [hasOlderMessages, loadMessages, olderMessagesLoading]);

  const filteredChannels = channels
    .filter((channel) =>
      String(getChannelDisplayName(channel) || channel.name || '')
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    );
  const showConversationPanel = Boolean(activeChannel || pendingDirectContact);

  const handleCreateChannel = async () => {
    try {
      setCreateChannelLoading(true);
      setCreateChannelError('');
      const selectedParticipants = contactOptions.filter((item) => selectedNewChatUsers.includes(item.key));
      const memberUserIds = Array.from(
        new Set(
          selectedParticipants
            .map((participant) => participant.userId)
            .filter(Boolean)
        )
      );
      if (memberUserIds.length === 1) {
        const selected = selectedParticipants[0];
        setShowNewChannel(false);
        setNewChannelName('');
        setSelectedNewChatUsers([]);
        setActiveChannel(null);
        setPendingDirectContact({
          userId: String(memberUserIds[0]),
          label: String(selected?.label || 'Team Member'),
        });
        return;
      }

      if (!newChannelName.trim() && memberUserIds.length === 0) {
        throw new Error('Enter a group name or select at least one member');
      }

      const generatedName = newChannelName.trim();

      const response = await fetch('/api/messages/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: generatedName || null, memberUserIds }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.item) throw new Error(payload?.error || 'Failed to create channel');
      const createdChannel = payload.item;
      setShowNewChannel(false);
      setNewChannelName('');
      setSelectedNewChatUsers([]);
      setChannels((prev) => {
        const next = [createdChannel, ...prev.filter((channel) => String(channel.id) !== String(createdChannel.id))];
        return next;
      });
      void loadChannels(true);
      setPendingDirectContact(null);
      setActiveChannel(createdChannel);
    } catch (error) {
      setCreateChannelError(error instanceof Error ? error.message : 'Failed to create channel');
    } finally {
      setCreateChannelLoading(false);
    }
  };

  const MAX_ATTACHMENTS = 10;

  const formatFileSize = (bytes) => {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImageAttachment = (att) =>
    Boolean(att?.is_image) || String(att?.content_type || '').toLowerCase().startsWith('image/');

  const isVideoAttachment = (att) =>
    Boolean(att?.is_video) || isVideoAttachmentContentType(att?.content_type);

  const iconForContentType = (contentType) => {
    const t = String(contentType || '').toLowerCase();
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('video/')) return 'file-video';
    if (t.includes('pdf')) return 'file-pdf';
    if (t.includes('word') || t.includes('msword')) return 'file-word';
    if (t.includes('sheet') || t.includes('excel') || t.includes('csv')) return 'file-excel';
    return 'file';
  };

  // Single source of truth for selected files = pendingAttachments state.
  const addFilesToPending = async (files) => {
    setSendError('');
    const incoming = Array.from(files || []);
    if (incoming.length === 0) return;
    setAttachmentPreparing(true);
    try {
      const prepared = [];
      let nextCount = pendingAttachments.length;
      let nextTotalBytes = pendingAttachments.reduce((sum, item) => sum + Number(item.file?.size || 0), 0);
      for (const file of incoming) {
        if (nextCount >= MAX_ATTACHMENTS) {
          setSendError(`You can attach at most ${MAX_ATTACHMENTS} files.`);
          break;
        }
        const extension = String(file.name || '').split('.').pop()?.toLowerCase() || '';
        const isVideo = isVideoAttachmentContentType(file.type) || VIDEO_ATTACHMENT_EXTENSIONS.has(extension);
        let durationSeconds;
        let contentType = file.type || 'application/octet-stream';
        if (isVideo) {
          if (file.size > MAX_VIDEO_ATTACHMENT_BYTES) {
            setSendError(`"${file.name}": Video is larger than ${MESSAGE_ATTACHMENT_SIZE_LIMIT_MIB} MiB.`);
            continue;
          }
          try {
            durationSeconds = await readVideoDurationSeconds(file);
          } catch (error) {
            setSendError(`"${file.name}": ${error instanceof Error ? error.message : 'Video is not supported'}.`);
            continue;
          }
          const validation = validateVideoAttachmentPolicy({
            fileName: file.name,
            contentType: inferVideoAttachmentContentType(file.name, file.type),
            sizeBytes: file.size,
            durationSeconds,
          });
          if (!validation.ok) {
            setSendError(`"${file.name}": ${validation.error}.`);
            continue;
          }
          contentType = validation.contentType;
        } else {
          const validation = validateAttachmentMetadata({
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            maxBytes: MAX_STANDARD_MESSAGE_ATTACHMENT_BYTES,
          });
          if (!validation.ok) {
            const sizeMessage = file.size > MAX_STANDARD_MESSAGE_ATTACHMENT_BYTES
              ? `File is larger than ${MESSAGE_ATTACHMENT_SIZE_LIMIT_MIB} MiB`
              : validation.error;
            setSendError(`"${file.name}": ${sizeMessage}.`);
            continue;
          }
          contentType = validation.contentType;
        }
        if (nextTotalBytes + file.size > MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES) {
          setSendError(`Attachments exceed the ${MESSAGE_ATTACHMENT_SIZE_LIMIT_MIB * MAX_ATTACHMENTS} MiB total message limit.`);
          continue;
        }
        prepared.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
          file,
          duration_seconds: durationSeconds,
          content_type: contentType,
          previewUrl: file.type.startsWith('image/') || isVideo ? URL.createObjectURL(file) : '',
          isVideo,
          progress: 0,
          status: 'ready',
        });
        nextCount += 1;
        nextTotalBytes += file.size;
      }
      if (prepared.length > 0) setPendingAttachments((prev) => [...prev, ...prepared]);
    } finally {
      setAttachmentPreparing(false);
    }
  };

  // Open the ONE stable hidden file input via ref. Programmatic .click() inside
  // this button-click gesture works in iOS WKWebView (the native app), unlike a
  // label wrapping a display:none input, which silently fails to fire onChange.
  const openFilePicker = () => {
    // The OS file picker blurs the window; on refocus, the app's global
    // focus/visibility handler runs verifySetup() which remounts this view and
    // loses the input's onChange. Suppress that refresh for the duration of the
    // pick (same mechanism DocumentsView uses). This sets a window flag only —
    // it does NOT change any React/thread/view state, so it cannot cause a
    // re-render itself.
    if (typeof window !== 'undefined') {
      window.__groundworkSuppressSetupRefreshUntil = Date.now() + 120000;
    }
    fileInputRef.current?.click();
  };

  const handleAttachmentSelect = (event) => {
    // Keep the refresh suppressed briefly past selection so the refocus that
    // fires when the picker closes doesn't remount us before state is stored.
    if (typeof window !== 'undefined') {
      window.__groundworkSuppressSetupRefreshUntil = Date.now() + 8000;
    }
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length > 0) void addFilesToPending(files);
    // Clear AFTER storing so re-selecting the same file still fires onChange.
    event.currentTarget.value = '';
  };

  const removePendingAttachment = (id) => {
    const target = pendingAttachmentsRef.current.find((item) => item.id === id);
    uploadAbortControllersRef.current.get(id)?.abort();
    uploadAbortControllersRef.current.delete(id);
    const cleanupChannelId = activeChannelIdRef.current || attachmentContextRef.current.channelId;
    if (target?.upload?.path && cleanupChannelId) {
      void fetch(`/api/messages/threads/${cleanupChannelId}/attachments/sign`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [target.upload.path] }),
        keepalive: true,
      }).catch(() => null);
    }
    setPendingAttachments((prev) => {
      const pending = prev.find((a) => a.id === id);
      if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const clearPendingAttachments = () => {
    setPendingAttachments((prev) => {
      prev.forEach((a) => {
        uploadAbortControllersRef.current.delete(a.id);
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
      return [];
    });
  };

  const renderComposerAttachments = () => (
    <>
      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" data-testid="messages-attachment-previews">
          {pendingAttachments.map((att) => (
            <div key={att.id} className="relative flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1.5 pr-7 dark:border-zinc-800 dark:bg-[#111111]">
              {att.previewUrl && att.isVideo ? (
                <video
                  src={`${att.previewUrl}#t=0.001`}
                  aria-label={`Video preview for ${att.file.name}`}
                  className="h-10 w-10 rounded bg-black object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              ) : att.previewUrl ? (
                <img src={att.previewUrl} alt={att.file.name} className="h-10 w-10 rounded object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded bg-gray-200 text-gray-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <Icon name={iconForContentType(att.file.type)} />
                </span>
              )}
              <div className="min-w-0 max-w-[9rem]">
                <p className="truncate text-xs font-medium text-gray-800 dark:text-zinc-200">{att.file.name}</p>
                <p className="text-[10px] text-gray-500 dark:text-zinc-500">
                  {att.status === 'uploading'
                    ? `Uploading ${att.progress || 0}%`
                    : att.status === 'uploaded'
                      ? 'Uploaded'
                      : att.status === 'error'
                        ? 'Upload failed — retry'
                        : `${formatFileSize(att.file.size)}${att.isVideo && att.duration_seconds ? ` · ${Math.ceil(att.duration_seconds)} sec` : ''}`}
                </p>
                {att.status === 'uploading' && (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-700" role="progressbar" aria-valuenow={att.progress || 0} aria-valuemin="0" aria-valuemax="100">
                    <div className="h-full bg-brand-500" style={{ width: `${att.progress || 0}%` }} />
                  </div>
                )}
                {att.status === 'error' && (
                  <button
                    type="button"
                    onClick={(event) => handleSendMessage(event)}
                    disabled={sendLoading}
                    className="mt-1 text-[10px] font-semibold text-brand-600 underline underline-offset-2 disabled:opacity-50 dark:text-brand-400"
                    data-testid={`messages-attachment-retry-${att.id}`}
                  >
                    Retry upload
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => removePendingAttachment(att.id)}
                disabled={attachmentPreparing}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-zinc-700"
                aria-label={`Remove ${att.file.name}`}
              >
                <Icon name="xmark" />
              </button>
            </div>
          ))}
        </div>
      )}
      {attachmentPreparing && (
        <p className="mb-2 text-xs text-gray-500 dark:text-zinc-400" data-testid="messages-attachment-preparing">
          Preparing video preview…
        </p>
      )}
    </>
  );

  const attachDisabled = sendLoading || attachmentPreparing || pendingAttachments.length >= MAX_ATTACHMENTS;
  // A real button that programmatically clicks the ONE stable hidden input (see
  // the top-level return). The input is NOT inside this conditional composer, so
  // it never remounts when the active thread changes mid-selection.
  const renderAttachButton = () => (
    <button
      type="button"
      onClick={openFilePicker}
      disabled={attachDisabled}
      title="Attach photos, videos, or files"
      data-testid="messages-attach-button"
      className="shrink-0 rounded-xl p-2.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-[#111111]"
    >
      <Icon name="paperclip" />
    </button>
  );

  const renderMessageAttachments = (msg, isMine) => {
    const list = Array.isArray(msg?.attachments) ? msg.attachments : [];
    if (list.length === 0) return null;
    const images = list.filter((att) => isImageAttachment(att) && att.download_url);
    const videos = list.filter((att) => isVideoAttachment(att) && att.download_url);
    const files = list.filter((att) => !((isImageAttachment(att) || isVideoAttachment(att)) && att.download_url));

    return (
      <div className="mt-2 flex flex-col gap-2">
        {images.length > 0 && (
          <div className={images.length === 1 ? 'w-full' : 'grid grid-cols-2 gap-1'}>
            {images.map((att) => (
              <div
                key={att.id}
                className={`group relative overflow-hidden rounded-lg border border-black/5 dark:border-white/10 ${
                  images.length === 1 ? 'max-w-full sm:max-w-[16rem]' : 'aspect-square'
                }`}
              >
                <a href={att.download_url} target="_blank" rel="noopener noreferrer" className="block">
                  <img
                    src={att.download_url}
                    alt={att.file_name || 'Image attachment'}
                    className={images.length === 1 ? 'max-h-64 w-full object-cover' : 'h-full w-full object-cover'}
                    loading="lazy"
                  />
                </a>
                {/* Explicit download over the existing signed URL (bucket is private). */}
                <a
                  href={att.download_url}
                  download={att.file_name || true}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="Download image"
                  aria-label={`Download ${att.file_name || 'image'}`}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 focus:opacity-100 group-hover:opacity-100"
                >
                  <Icon name="download" className="text-xs" />
                </a>
              </div>
            ))}
          </div>
        )}
        {videos.map((att) => (
          <div
            key={att.id}
            className="max-w-full overflow-hidden rounded-lg border border-black/10 bg-black dark:border-white/10 sm:max-w-[20rem]"
            data-testid={`messages-video-${att.id}`}
          >
            <video
              src={`${att.download_url}#t=0.001`}
              aria-label={att.file_name || 'Video attachment'}
              className="max-h-72 w-full bg-black object-contain"
              controls
              playsInline
              preload="metadata"
            />
            <div className="flex items-center justify-between gap-2 bg-black/80 px-2.5 py-2 text-white">
              <span className="min-w-0 truncate text-[11px]">{att.file_name || 'Video'}</span>
              <a
                href={att.download_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[11px] font-medium text-white underline underline-offset-2"
              >
                Open video
              </a>
            </div>
          </div>
        ))}
        {files.map((att) => (
          <a
            key={att.id}
            href={att.download_url || undefined}
            download={att.file_name || true}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex max-w-full items-center gap-3 rounded-lg border p-2.5 no-underline sm:max-w-[18rem] ${
              isMine
                ? 'border-white/20 bg-white/10 hover:bg-white/20'
                : 'border-gray-200 bg-gray-50 hover:bg-gray-100 dark:border-zinc-700 dark:bg-[#0c0c0c] dark:hover:bg-[#151515]'
            }`}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded ${isMine ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
              <Icon name={iconForContentType(att.content_type)} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-xs font-medium ${isMine ? 'text-white' : 'text-gray-800 dark:text-zinc-100'}`}>{att.file_name || 'Attachment'}</span>
              <span className={`block text-[10px] ${isMine ? 'text-white/70' : 'text-gray-500 dark:text-zinc-400'}`}>{formatFileSize(att.file_size)}</span>
            </span>
            <Icon name="download" className={isMine ? 'text-white/80' : 'text-gray-400'} />
          </a>
        ))}
      </div>
    );
  };

  const handleSendMessage = async (e) => {
    // Defensive: never let a click/keypress bubble into a native form submit /
    // navigation. The composer is not in a <form>, but this keeps it robust.
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const trimmedText = messageText.trim();
    const attachmentsSnapshot = pendingAttachments;
    if (sendLoading || (!trimmedText && attachmentsSnapshot.length === 0) || attachmentPreparing) return;
    let channelId = activeChannel?.id ? String(activeChannel.id) : '';
    let signedPaths = [];
    // Clear only the message being sent. The textarea remains enabled while a
    // large upload runs, so the user can compose the next message without the
    // completed send wiping that newer draft.
    setMessageText('');
    try {
      setSendLoading(true);
      setSendError('');
      if (!channelId && pendingDirectContact?.userId) {
        const createResponse = await fetch('/api/messages/direct/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: pendingDirectContact.userId,
            label: String(pendingDirectContact.label || 'Direct Message'),
          }),
        });
        const createPayload = await createResponse.json();
        if (!createResponse.ok || !createPayload?.item?.id) {
          throw new Error(createPayload?.error || 'Failed to create direct chat');
        }
        channelId = String(createPayload.item.id);
        attachmentContextRef.current = {
          ...attachmentContextRef.current,
          channelId,
        };
      }
      if (!channelId) return;

      // Attachments upload DIRECTLY to Supabase Storage via short-lived signed
      // upload URLs, so file bytes never pass through the serverless function
      // (which caps request bodies well below the attachment limits). We then send the
      // message with only the resulting object metadata.
      const attachmentPayload = [];
      if (attachmentsSnapshot.length > 0) {
        setPendingAttachments((prev) => prev.map((att) => ({ ...att, status: 'uploading', progress: 0 })));
        const signRes = await fetch(`/api/messages/threads/${channelId}/attachments/sign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: attachmentsSnapshot.map((att) => ({
              file_name: att.file.name,
              content_type: att.content_type,
              file_size: att.file.size,
              duration_seconds: att.duration_seconds,
            })),
          }),
        });
        const signPayload = await signRes.json().catch(() => null);
        if (!signRes.ok || !Array.isArray(signPayload?.uploads)) {
          throw new Error(signPayload?.error || 'Failed to prepare upload');
        }
        signedPaths = signPayload.uploads.map((upload) => String(upload.path || '')).filter(Boolean);
        setPendingAttachments((prev) => prev.map((att, index) => ({
          ...att,
          upload: signPayload.uploads[index] || null,
        })));
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        if (!supabaseUrl) throw new Error('Message attachment storage is not configured');
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        const storageHeaders = anonKey ? { apikey: anonKey } : {};
        for (let i = 0; i < signPayload.uploads.length; i += 1) {
          const up = signPayload.uploads[i];
          const file = attachmentsSnapshot[i].file;
          const attachmentId = attachmentsSnapshot[i].id;
          const controller = new AbortController();
          uploadAbortControllersRef.current.set(attachmentId, controller);
          try {
            await uploadAttachmentWithProgress({
              supabaseUrl,
              bucket: up.bucket,
              path: up.path,
              token: up.token,
              file,
              contentType: up.content_type,
              headers: storageHeaders,
              signal: controller.signal,
              onProgress: (progress) => {
                setPendingAttachments((prev) => prev.map((att) => (
                  att.id === attachmentId ? { ...att, status: 'uploading', progress } : att
                )));
              },
            });
            setPendingAttachments((prev) => prev.map((att) => (
              att.id === attachmentId ? { ...att, status: 'uploaded', progress: 100 } : att
            )));
          } catch (error) {
            setPendingAttachments((prev) => prev.map((att) => (
              att.id === attachmentId ? { ...att, status: 'error' } : att
            )));
            await fetch(`/api/messages/threads/${channelId}/attachments/sign`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ paths: signedPaths }),
            }).catch(() => null);
            setPendingAttachments((prev) => prev.map((att) => (
              att.id === attachmentId
                ? { ...att, status: 'error', upload: null }
                : { ...att, status: 'ready', progress: 0, upload: null }
            )));
            signedPaths = [];
            throw new Error(`"${file.name}": ${error instanceof Error ? error.message : 'Upload failed'}`);
          } finally {
            uploadAbortControllersRef.current.delete(attachmentId);
          }
          attachmentPayload.push({
            path: up.path,
            file_name: up.file_name,
            content_type: up.content_type,
            file_size: up.file_size,
            duration_seconds: up.duration_seconds,
          });
        }
      }

      const response = await fetch(`/api/messages/threads/${channelId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmedText, attachments: attachmentPayload }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.item) {
        if (signedPaths.length > 0) {
          await fetch(`/api/messages/threads/${channelId}/attachments/sign`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: signedPaths }),
          }).catch(() => null);
          signedPaths = [];
        }
        setPendingAttachments((prev) => prev.map((att) => ({
          ...att,
          status: 'ready',
          progress: 0,
          upload: null,
        })));
        throw new Error(payload?.error || 'Failed to send message');
      }
      const sentBody = trimmedText;
      const attachmentCount = attachmentsSnapshot.length;
      clearPendingAttachments();
      const pendingLabel = String(pendingDirectContact?.label || 'Team Member');
      const pendingUserId = String(pendingDirectContact?.userId || '');
      pendingScrollActionRef.current = 'send';
      setNewMessagesBelow(0);
      setMessages((prev) => (
        prev.some((item) => String(item.id) === String(payload.item.id))
          ? prev
          : [
              ...prev,
              {
                ...payload.item,
                attachments: Array.isArray(payload.item.attachments) ? payload.item.attachments : [],
                sender_display_name: 'You',
                sender_avatar_url: '',
              },
            ]
      ));
      setChannels((prev) => {
        const existing = prev.find((channel) => String(channel.id) === String(channelId));
        const nextChannel = {
          ...(existing || {
            id: channelId,
            kind: pendingUserId ? 'direct' : 'group',
            name: pendingLabel,
            created_at: payload.item.created_at,
            member_count: pendingUserId ? 2 : 1,
          }),
          other_user_id: existing?.other_user_id || pendingUserId || null,
          last_message_at: payload.item.created_at,
          updated_at: payload.item.created_at,
          last_message_preview: sentBody || (attachmentCount === 1 ? '📎 Attachment' : `📎 ${attachmentCount} attachments`),
          message_count: Number(existing?.message_count || 0) + 1,
          unread_count: 0,
        };
        return [nextChannel, ...prev.filter((channel) => String(channel.id) !== String(channelId))];
      });
      // Only a REAL pending direct chat gets a forced display label + identity
      // rebuild. For existing threads (companywide/group/DM) we must preserve the
      // thread's own name/kind/is_companywide — otherwise the companywide chat
      // would be renamed to the "Team Member" fallback on every send.
      if (channelId && pendingUserId) {
        setForcedDirectLabels((prev) => ({
          ...prev,
          [String(channelId)]: pendingLabel,
        }));
      }
      setPendingDirectContact(null);
      if (pendingUserId) {
        setActiveChannel((current) => ({
          ...(current && String(current.id) === String(channelId) ? current : activeChannel || {}),
          id: channelId,
          kind: 'direct',
          name: pendingLabel,
          other_user_id: pendingUserId,
          message_count: Number(activeChannel?.message_count || 0) + 1,
        }));
      } else {
        // Existing thread: keep its identity intact, just bump the message count.
        setActiveChannel((current) => (
          current && String(current.id) === String(channelId)
            ? { ...current, message_count: Number(current.message_count || 0) + 1 }
            : current
        ));
      }
      loadChannels(true);
    } catch (error) {
      setPendingAttachments((prev) => prev.map((att) => (
        att.status === 'error' ? att : { ...att, status: 'ready', progress: 0 }
      )));
      setMessageText((current) => current.trim() ? current : messageText);
      setSendError(error instanceof Error ? error.message : 'Failed to send message');
    } finally {
      setSendLoading(false);
    }
  };

  const handleAddMembers = async () => {
    if (!activeChannel?.id || selectedAddMembers.length === 0) return;
    const response = await fetch(`/api/messages/channels/${activeChannel.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: selectedAddMembers }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMembersError(payload?.error || 'Failed to add members');
      return;
    }
    setSelectedAddMembers([]);
    await loadMembers(activeChannel.id);
    await loadChannels();
  };

  const handleLeave = async () => {
    if (!activeChannel?.id) return;
    const response = await fetch(`/api/messages/channels/${activeChannel.id}/members/me`, { method: 'DELETE' });
    if (!response.ok) return;
    setShowMembers(false);
    await loadChannels();
  };

  const handleRemoveMember = async (userId) => {
    if (!activeChannel?.id) return;
    const response = await fetch(`/api/messages/channels/${activeChannel.id}/members/${userId}`, { method: 'DELETE' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setMembersError(payload?.error || 'Failed to remove member');
      return;
    }
    await loadMembers(activeChannel.id);
    await loadChannels();
  };

  const startEditMessage = (msg) => {
    setMsgMenuOpenId('');
    setMsgActionError('');
    setEditingMsgId(String(msg.id));
    setEditingText(String(msg.body || ''));
  };

  const cancelEditMessage = () => {
    setEditingMsgId('');
    setEditingText('');
  };

  const saveEditMessage = async (msg) => {
    const threadId = String(activeChannel?.id || '');
    const nextBody = editingText.trim();
    if (!threadId || !nextBody) return;
    if (nextBody === String(msg.body || '')) {
      cancelEditMessage();
      return;
    }
    setMsgActionError('');
    try {
      const response = await fetch(`/api/messages/threads/${threadId}/messages/${msg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: nextBody }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.item) throw new Error(payload?.error || 'Failed to edit message');
      setMessages((prev) => prev.map((m) => (
        String(m.id) === String(msg.id)
          ? { ...m, body: payload.item.body, edited_at: payload.item.edited_at ?? new Date().toISOString() }
          : m
      )));
      cancelEditMessage();
    } catch (error) {
      setMsgActionError(error instanceof Error ? error.message : 'Failed to edit message');
    }
  };

  const deleteMessage = async (msg) => {
    const threadId = String(activeChannel?.id || '');
    if (!threadId) return;
    setMsgMenuOpenId('');
    if (typeof window !== 'undefined' && !window.confirm('Delete this message? This cannot be undone.')) return;
    setMsgActionError('');
    try {
      const response = await fetch(`/api/messages/threads/${threadId}/messages/${msg.id}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.item?.deleted) throw new Error(payload?.error || 'Failed to delete message');
      setMessages((prev) => prev.filter((m) => String(m.id) !== String(msg.id)));
    } catch (error) {
      setMsgActionError(error instanceof Error ? error.message : 'Failed to delete message');
    }
  };

  return (
    <div
      className="fixed inset-x-0 top-[var(--messages-mobile-top,var(--mobile-header-total-height))] z-10 flex h-[var(--messages-mobile-height,calc(100dvh-var(--mobile-header-total-height)))] min-h-0 w-full max-w-full overflow-hidden border-t border-gray-200 bg-white shadow-none dark:border-zinc-800 dark:bg-[#050505] md:relative md:inset-auto md:z-auto md:h-[calc(100dvh-170px)] md:min-h-[700px] md:rounded-xl md:border md:shadow-[0_10px_30px_rgba(0,0,0,0.08)] md:dark:shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
      style={mobileViewportStyle}
      data-testid="messages-root"
    >
      {/* ONE stable hidden file input — mounted at the root of MessagesView, NOT
          inside a conditional composer, so it survives thread switches and the
          picker's async selection always fires onChange on the same element. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
        className="hidden"
        onChange={handleAttachmentSelect}
        data-testid="messages-attach-input"
      />
      <div className={`min-w-0 w-full md:w-80 md:shrink-0 bg-white border-r border-gray-200 dark:border-zinc-800 dark:bg-[#090909] flex-col ${showConversationPanel ? 'hidden md:flex' : 'flex'}`} data-testid="messages-sidebar">
        <div className="space-y-3 border-b border-gray-200 p-4 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold tracking-wide text-gray-900 dark:text-zinc-100">Chats</h3>
            <Button variant="secondary" size="sm" onClick={() => setShowNewChannel(true)} data-testid="messages-create-channel-open">
              <Icon name="pen-to-square" />
            </Button>
          </div>
          {newIncomingCount > 0 && (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              {newIncomingCount} new message{newIncomingCount > 1 ? 's' : ''} received
            </p>
          )}
          <div className="relative">
            <Icon name="magnifying-glass" className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-zinc-500" />
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search" className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-brand-500 dark:border-zinc-800 dark:bg-[#111111] dark:text-zinc-100 dark:placeholder:text-zinc-500" />
          </div>
          {channelsError && <p className="mt-3 text-sm text-red-500 dark:text-red-300">{channelsError}</p>}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {channelsLoading ? <div className="px-4 py-3 text-sm text-gray-500 dark:text-zinc-400">Loading channels...</div> : filteredChannels.length === 0 ? <div className="px-4 py-3 text-sm text-gray-500 dark:text-zinc-400">No channels yet.</div> : filteredChannels.map((channel) => (
              <button key={channel.id} onClick={() => { setActiveChannel(channel); setMessagesError(''); }} className={`w-full min-w-0 border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 dark:border-zinc-900 dark:hover:bg-[#131313] ${activeChannel?.id === channel.id ? 'bg-brand-500 text-white dark:bg-brand-600' : ''}`} data-testid={`messages-channel-${channel.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm font-medium ${activeChannel?.id === channel.id ? 'text-white' : 'text-gray-900 dark:text-zinc-100'}`}>
                    {getChannelDisplayName(channel)}
                  </span>
                  {(channel.unread_count ?? channel.message_count) > 0 && <span className={`rounded-full px-1.5 py-0.5 text-xs ${activeChannel?.id === channel.id ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700 dark:bg-zinc-800 dark:text-zinc-200'}`}>{channel.unread_count ?? channel.message_count}</span>}
                </div>
                <p className={`truncate text-xs ${activeChannel?.id === channel.id ? 'text-white/85' : 'text-gray-500 dark:text-zinc-400'}`}>
                  {channel.last_message_at ? formatThreadSubtextTime(channel.last_message_at) : (channel.last_message_preview || 'No messages yet')}
                </p>
              </button>
            ))}
            {pendingDirectContact && (
              <button
                type="button"
                onClick={() => setActiveChannel(null)}
                className="w-full border-b border-gray-100 bg-brand-500 px-4 py-3 text-left dark:border-zinc-900 dark:bg-brand-600"
                data-testid="messages-channel-pending-direct"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate text-white">{pendingDirectContact.label}</span>
                </div>
                <p className="text-xs truncate text-white/80">No messages yet</p>
              </button>
            )}
          </div>
        </div>
      </div>

      {activeChannel ? (
        <div className="relative flex min-w-0 flex-1 flex-col bg-white dark:bg-[#050505]" data-testid="messages-thread">
          <div className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-[#090909] sm:px-6 sm:py-4" data-testid="messages-thread-header">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand-600 dark:text-brand-400 md:hidden"
                onClick={() => {
                  setActiveChannel(null);
                  setPendingDirectContact(null);
                }}
                data-testid="messages-back"
              >
                <Icon name="chevron-left" /> Back
              </button>
              {isDirectChannel(activeChannel) && (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 text-xs font-semibold text-gray-700 dark:bg-zinc-800 dark:text-zinc-200">
                  {userAvatarById.get(String(activeChannel.other_user_id || '')) ? (
                    <img
                      src={String(userAvatarById.get(String(activeChannel.other_user_id || '')))}
                      alt={getChannelDisplayName(activeChannel)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initialsForName(getChannelDisplayName(activeChannel))
                  )}
                </span>
              )}
              <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold text-gray-900 dark:text-zinc-100" data-testid="messages-active-channel">
                {getChannelDisplayName(activeChannel)}
              </h3>
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                {activeChannel.is_companywide
                  ? 'Company chat'
                  : isDirectChannel(activeChannel)
                    ? 'Direct message'
                    : Number(activeChannel.member_count || 0) > 0
                      ? `${Number(activeChannel.member_count)} member${Number(activeChannel.member_count) === 1 ? '' : 's'}`
                      : 'Group chat'}
              </p>
              </div>
            </div>
            {!isDirectChannel(activeChannel) && (
              <div className="relative flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => setHeaderMenuOpen((v) => !v)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-[#111111]"
                  title="Chat options"
                  aria-label="Chat options"
                  data-testid="messages-header-menu"
                >
                  <Icon name="ellipsis" />
                </button>
                {headerMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setHeaderMenuOpen(false)} />
                    <div className="absolute right-0 top-10 z-50 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-[#0c0c0c]">
                      {activeChannel.is_companywide && viewerIsAdmin && (
                        <button type="button" onClick={() => { setHeaderMenuOpen(false); openRenameTeamChat(); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-zinc-200 dark:hover:bg-[#151515]" data-testid="messages-rename-companywide">
                          <Icon name="pen" className="text-xs text-gray-400" /> Rename chat
                        </button>
                      )}
                      <button type="button" onClick={() => { setHeaderMenuOpen(false); setShowMembers(true); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-zinc-200 dark:hover:bg-[#151515]" data-testid="messages-members-open">
                        <Icon name="users" className="text-xs text-gray-400" /> View members
                      </button>
                      {!activeChannel.is_companywide && isGroupChannel(activeChannel) && (
                        <button type="button" onClick={() => { setHeaderMenuOpen(false); handleLeave(); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30" data-testid="messages-leave-chat-header">
                          <Icon name="right-from-bracket" className="text-xs" /> Leave chat
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div
            ref={messagesScrollRef}
            onScroll={handleMessagesScroll}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain bg-gray-50/40 p-3 dark:bg-[#050505] sm:p-6"
            data-testid="messages-scroll-region"
          >
            {hasOlderMessages && !messagesLoading && (
              <div className="flex justify-center pb-1">
                <button
                  type="button"
                  onClick={loadOlderMessages}
                  disabled={olderMessagesLoading}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm disabled:opacity-50 dark:border-zinc-800 dark:bg-[#111111] dark:text-zinc-300"
                  data-testid="messages-load-older"
                >
                  {olderMessagesLoading ? 'Loading…' : 'Load earlier messages'}
                </button>
              </div>
            )}
            {messagesLoading ? <div className="text-sm text-gray-500 dark:text-zinc-400">Loading messages...</div> : messagesError ? <div className="text-sm text-red-500 dark:text-red-300">{messagesError}</div> : messages.length === 0 ? <div className="text-sm text-gray-500 dark:text-zinc-400">No messages yet.</div> : messages.map((msg, index) => {
              const isMine = myUserId && String(msg.sender_user_id || '') === String(myUserId);
              const dayKey = getMessageDayKey(msg.created_at);
              const prevDayKey = index > 0 ? getMessageDayKey(messages[index - 1].created_at) : '';
              const showDayDivider = dayKey && dayKey !== prevDayKey;
              return (
                <div key={msg.id}>
                  {showDayDivider && (
                    <div className="flex items-center gap-3 my-3">
                      <div className="h-px flex-1 bg-gray-200 dark:bg-zinc-800" />
                      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-zinc-500">{formatMessageDayLabel(msg.created_at)}</div>
                      <div className="h-px flex-1 bg-gray-200 dark:bg-zinc-800" />
                    </div>
                  )}
                  <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`} data-testid={`messages-message-${msg.id}`}>
                    <div className={`flex max-w-[88%] min-w-0 md:max-w-[min(82%,36rem)] ${isMine ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
                      {isGroupChannel(activeChannel) && !isMine && (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 text-[10px] font-semibold text-gray-700 dark:bg-zinc-800 dark:text-zinc-200">
                          {msg.sender_avatar_url ? (
                            <img src={msg.sender_avatar_url} alt={msg.sender_display_name || 'Team Member'} className="h-full w-full object-cover" />
                          ) : (
                            initialsForName(msg.sender_display_name || 'Team Member')
                          )}
                        </span>
                      )}
                    <div className={`flex min-w-0 flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                    {isGroupChannel(activeChannel) && (
                      <p className={`mb-1 px-1 text-[11px] font-semibold ${isMine ? 'text-gray-500 dark:text-zinc-400' : 'text-gray-600 dark:text-zinc-300'}`}>
                        {msg.sender_display_name || (isMine ? 'You' : 'Team Member')}
                      </p>
                    )}
                    <div className={`group flex items-start gap-1 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`max-w-full rounded-2xl px-4 py-2.5 ${
                      isMine
                        ? 'rounded-br-md bg-brand-600 text-white dark:bg-brand-500'
                        : 'rounded-bl-md border border-zinc-800 bg-[#111111] text-zinc-100'
                    }`}>
                      {editingMsgId === String(msg.id) ? (
                        <div className="flex flex-col gap-2" data-testid={`messages-edit-box-${msg.id}`}>
                          <textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEditMessage(msg); } if (e.key === 'Escape') cancelEditMessage(); }}
                            rows={2}
                            autoFocus
                            className="w-full min-w-[12rem] resize-none rounded-lg border border-white/30 bg-white/15 px-2 py-1 text-sm text-white placeholder:text-white/60 focus:outline-none"
                          />
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={cancelEditMessage} className="rounded-md px-2 py-1 text-xs font-medium text-white/80 hover:bg-white/10">Cancel</button>
                            <button type="button" onClick={() => saveEditMessage(msg)} disabled={!editingText.trim()} className="rounded-md bg-white/20 px-2 py-1 text-xs font-semibold text-white hover:bg-white/30 disabled:opacity-50" data-testid={`messages-edit-save-${msg.id}`}>Save</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {msg.body ? <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p> : null}
                          {renderMessageAttachments(msg, isMine)}
                          <p className={`mt-1 text-[10px] ${isMine ? 'text-white/80' : 'text-gray-500 dark:text-zinc-400'}`}>
                            {formatMessageTime(msg.edited_at || msg.created_at)}
                            {msg.edited_at ? <span className="italic"> · edited</span> : null}
                          </p>
                        </>
                      )}
                    </div>
                    {isMine && editingMsgId !== String(msg.id) && (
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setMsgMenuOpenId(msgMenuOpenId === String(msg.id) ? '' : String(msg.id))}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 opacity-0 hover:bg-gray-100 hover:text-gray-600 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-[#151515]"
                          aria-label="Message options"
                          data-testid={`messages-message-menu-${msg.id}`}
                        >
                          <Icon name="ellipsis" />
                        </button>
                        {msgMenuOpenId === String(msg.id) && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setMsgMenuOpenId('')} />
                            <div className="absolute right-0 top-8 z-50 w-36 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-[#0c0c0c]">
                              {msg.body ? (
                                <button type="button" onClick={() => startEditMessage(msg)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-zinc-200 dark:hover:bg-[#151515]" data-testid={`messages-edit-${msg.id}`}>
                                  <Icon name="pen" className="text-xs text-gray-400" /> Edit
                                </button>
                              ) : null}
                              <button type="button" onClick={() => deleteMessage(msg)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30" data-testid={`messages-delete-${msg.id}`}>
                                <Icon name="trash" className="text-xs" /> Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    </div>
                    </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {msgActionError && (
              <div className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" data-testid="messages-action-error">
                {msgActionError}
              </div>
            )}
            <div ref={messagesEndRef} />
            {newMessagesBelow > 0 && (
              <div className="pointer-events-none sticky bottom-2 z-10 flex justify-center">
                <button
                  type="button"
                  onClick={jumpToLatestMessage}
                  className="pointer-events-auto inline-flex min-h-9 items-center gap-2 rounded-full bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-lg"
                  data-testid="messages-jump-to-bottom"
                >
                  <Icon name="arrow-down" />
                  {newMessagesBelow} new message{newMessagesBelow === 1 ? '' : 's'}
                </button>
              </div>
            )}
          </div>

          <div className="z-10 shrink-0 border-t border-gray-200 bg-white px-3 pb-[calc(0.75rem+var(--mobile-safe-bottom))] pt-2.5 dark:border-zinc-800 dark:bg-[#090909] sm:px-6 sm:py-4" data-testid="messages-composer">
            {renderComposerAttachments()}
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              {renderAttachButton()}
              <div className="relative min-w-0 flex-1">
                <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder="Send message" className="min-h-11 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-brand-500 dark:border-zinc-800 dark:bg-[#111111] dark:text-zinc-100 dark:placeholder:text-zinc-500" rows="1" data-testid="messages-input" />
              </div>
              <button type="button" onClick={(e) => handleSendMessage(e)} disabled={(!messageText.trim() && pendingAttachments.length === 0) || sendLoading || attachmentPreparing} className="shrink-0 p-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" data-testid="messages-send">
                <Icon name={sendLoading ? 'spinner' : 'paper-plane'} className={sendLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            {sendError && <p className="mt-2 text-xs text-red-500 dark:text-red-300">{sendError}</p>}
            <p className="mt-2 hidden text-xs text-gray-500 dark:text-zinc-500 sm:block">Press Enter to send, Shift + Enter for new line</p>
          </div>
        </div>
      ) : pendingDirectContact ? (
        <div className="relative flex min-w-0 flex-1 flex-col bg-white dark:bg-[#050505]" data-testid="messages-thread">
          <div className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-[#090909] sm:px-6 sm:py-4" data-testid="messages-thread-header">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand-600 dark:text-brand-400 md:hidden"
                onClick={() => setPendingDirectContact(null)}
                data-testid="messages-back"
              >
                <Icon name="chevron-left" /> Back
              </button>
              <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold text-gray-900 dark:text-zinc-100">Message {pendingDirectContact.label}</h3>
              <p className="text-xs text-gray-500 dark:text-zinc-400">No messages yet</p>
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-gray-50/40 p-3 dark:bg-[#050505] sm:p-6">
            <div className="text-sm text-gray-500 dark:text-zinc-400">Send the first message to start this chat.</div>
          </div>
          <div className="z-10 shrink-0 border-t border-gray-200 bg-white px-3 pb-[calc(0.75rem+var(--mobile-safe-bottom))] pt-2.5 dark:border-zinc-800 dark:bg-[#090909] sm:px-6 sm:py-4" data-testid="messages-composer">
            {renderComposerAttachments()}
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              {renderAttachButton()}
              <div className="relative min-w-0 flex-1">
                <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder="Send message" className="min-h-11 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-brand-500 dark:border-zinc-800 dark:bg-[#111111] dark:text-zinc-100 dark:placeholder:text-zinc-500" rows="1" data-testid="messages-input" />
              </div>
              <button type="button" onClick={(e) => handleSendMessage(e)} disabled={(!messageText.trim() && pendingAttachments.length === 0) || sendLoading || attachmentPreparing} className="shrink-0 p-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" data-testid="messages-send">
                <Icon name={sendLoading ? 'spinner' : 'paper-plane'} className={sendLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            {sendError && <p className="mt-2 text-xs text-red-500 dark:text-red-300">{sendError}</p>}
            <p className="mt-2 hidden text-xs text-gray-500 dark:text-zinc-500 sm:block">Press Enter to send, Shift + Enter for new line</p>
          </div>
        </div>
      ) : (
        <div className="hidden flex-1 items-center justify-center bg-white dark:bg-[#050505] md:flex"><div className="text-center"><h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-zinc-100">Your Messages</h3></div></div>
      )}

      {showNewChannel && isMobileViewport && (
        <MobileSheet isOpen={showNewChannel} onClose={() => setShowNewChannel(false)} title="Create Group Chat" size="sm" headerVariant="form">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">Group Name (optional for direct chat)</label>
            <input type="text" value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} placeholder="e.g. field-updates" className="w-full rounded-lg border border-gray-200 px-4 py-2 focus:border-brand-500 focus:ring-2 focus:ring-brand-500 dark:border-zinc-800 dark:bg-[#111111] dark:text-zinc-100 dark:placeholder:text-zinc-500" data-testid="messages-create-channel-input" />
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">Add Members</label>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-zinc-800 dark:bg-[#111111]" data-testid="messages-create-channel-members">
              {contactOptions.map((contact) => (
                <label key={contact.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedNewChatUsers.includes(contact.key)}
                    onChange={(e) =>
                      setSelectedNewChatUsers((prev) =>
                        e.target.checked ? [...prev, contact.key] : prev.filter((id) => id !== contact.key)
                      )
                    }
                  />
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 text-[10px] font-semibold text-gray-700 dark:bg-zinc-800 dark:text-zinc-200">
                    {contact.avatarUrl ? (
                      <img src={contact.avatarUrl} alt={contact.label} className="h-full w-full object-cover" />
                    ) : (
                      initialsForName(contact.label)
                    )}
                  </span>
                  <span className="min-w-0 truncate">{contact.label}</span>
                </label>
              ))}
            </div>
            {createChannelError && <p className="text-sm text-red-600 dark:text-red-300">{createChannelError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowNewChannel(false)} disabled={createChannelLoading}>Cancel</Button>
              <Button variant="brand" onClick={handleCreateChannel} disabled={createChannelLoading} data-testid="messages-create-channel-submit">{createChannelLoading ? 'Creating...' : 'Create'}</Button>
            </div>
          </div>
        </MobileSheet>
      )}

      {showNewChannel && !isMobileViewport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="mx-4 w-full max-w-md overflow-hidden rounded-xl bg-white dark:border dark:border-zinc-800 dark:bg-[#090909]">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-zinc-800">
              <h3 className="font-semibold text-gray-900 dark:text-zinc-100">Create Group Chat</h3>
              <button onClick={() => setShowNewChannel(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-200"><Icon name="xmark" /></button>
            </div>
            <div className="p-6 space-y-3 max-h-[70vh] overflow-y-auto">
              <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">Group Name (optional for direct chat)</label>
              <input type="text" value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} placeholder="e.g. field-updates" className="w-full rounded-lg border border-gray-200 px-4 py-2 focus:border-brand-500 focus:ring-2 focus:ring-brand-500 dark:border-zinc-800 dark:bg-[#111111] dark:text-zinc-100 dark:placeholder:text-zinc-500" data-testid="messages-create-channel-input" />
              <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">Add Members</label>
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-zinc-800 dark:bg-[#111111]" data-testid="messages-create-channel-members">
                {contactOptions.map((contact) => (
                  <label key={contact.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedNewChatUsers.includes(contact.key)}
                      onChange={(e) =>
                        setSelectedNewChatUsers((prev) =>
                          e.target.checked ? [...prev, contact.key] : prev.filter((id) => id !== contact.key)
                        )
                      }
                    />
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 text-[10px] font-semibold text-gray-700 dark:bg-zinc-800 dark:text-zinc-200">
                      {contact.avatarUrl ? (
                        <img src={contact.avatarUrl} alt={contact.label} className="h-full w-full object-cover" />
                      ) : (
                        initialsForName(contact.label)
                      )}
                    </span>
                    <span className="min-w-0 truncate">{contact.label}</span>
                  </label>
                ))}
              </div>
              {createChannelError && <p className="text-sm text-red-600 dark:text-red-300">{createChannelError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setShowNewChannel(false)} disabled={createChannelLoading}>Cancel</Button>
                <Button variant="brand" onClick={handleCreateChannel} disabled={createChannelLoading} data-testid="messages-create-channel-submit">{createChannelLoading ? 'Creating...' : 'Create'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showMembers && activeChannel && isMobileViewport && (
        <MobileSheet isOpen={showMembers} onClose={() => setShowMembers(false)} title="Members" size="sm" headerVariant="form">
          <div className="space-y-3" data-testid="messages-members-modal">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between border-b border-gray-100 pb-2 text-sm dark:border-zinc-800 dark:text-zinc-200">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 text-[10px] font-semibold text-gray-700 dark:bg-zinc-800 dark:text-zinc-200">
                    {member.avatarUrl ? (
                      <img src={member.avatarUrl} alt={member.displayName} className="h-full w-full object-cover" />
                    ) : (
                      initialsForName(member.displayName)
                    )}
                  </span>
                  <span className="truncate">{member.displayName} {member.memberRole === 'owner' ? '(owner)' : ''}</span>
                </span>
                {member.memberRole !== 'owner' && <Button variant="secondary" size="sm" onClick={() => handleRemoveMember(member.userId)} data-testid={`messages-member-remove-${member.userId}`}>Remove</Button>}
              </div>
            ))}
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">Add Members</label>
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-zinc-800 dark:bg-[#111111]">
              {availableUsers.map((user) => (
                <label key={user.userId} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selectedAddMembers.includes(user.userId)} onChange={(e) => setSelectedAddMembers((prev) => e.target.checked ? [...prev, user.userId] : prev.filter((id) => id !== user.userId))} />
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 text-[10px] font-semibold text-gray-700 dark:bg-zinc-800 dark:text-zinc-200">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt={user.displayName} className="h-full w-full object-cover" />
                    ) : (
                      initialsForName(user.displayName)
                    )}
                  </span>
                  <span className="min-w-0 truncate">{user.displayName}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={handleLeave} data-testid="messages-leave-chat">Leave chat</Button>
              <Button variant="brand" onClick={handleAddMembers} data-testid="messages-add-members">Add selected</Button>
            </div>
            {membersError && <p className="text-sm text-red-600 dark:text-red-300">{membersError}</p>}
          </div>
        </MobileSheet>
      )}

      {showMembers && activeChannel && !isMobileViewport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="messages-members-modal">
          <div className="mx-4 w-full max-w-md overflow-hidden rounded-xl bg-white dark:border dark:border-zinc-800 dark:bg-[#090909]">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-zinc-800">
              <h3 className="font-semibold text-gray-900 dark:text-zinc-100">Members</h3>
              <button onClick={() => setShowMembers(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-200"><Icon name="xmark" /></button>
            </div>
            <div className="p-6 space-y-3 max-h-[70vh] overflow-y-auto">
              {members.map((member) => (
                <div key={member.id} className="flex items-center justify-between border-b border-gray-100 pb-2 text-sm dark:border-zinc-800 dark:text-zinc-200">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 text-[10px] font-semibold text-gray-700 dark:bg-zinc-800 dark:text-zinc-200">
                      {member.avatarUrl ? (
                        <img src={member.avatarUrl} alt={member.displayName} className="h-full w-full object-cover" />
                      ) : (
                        initialsForName(member.displayName)
                      )}
                    </span>
                    <span className="truncate">{member.displayName} {member.memberRole === 'owner' ? '(owner)' : ''}</span>
                  </span>
                  {member.memberRole !== 'owner' && <Button variant="secondary" size="sm" onClick={() => handleRemoveMember(member.userId)} data-testid={`messages-member-remove-${member.userId}`}>Remove</Button>}
                </div>
              ))}
              <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">Add Members</label>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-zinc-800 dark:bg-[#111111]">
                {availableUsers.map((user) => (
                  <label key={user.userId} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selectedAddMembers.includes(user.userId)} onChange={(e) => setSelectedAddMembers((prev) => e.target.checked ? [...prev, user.userId] : prev.filter((id) => id !== user.userId))} />
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 text-[10px] font-semibold text-gray-700 dark:bg-zinc-800 dark:text-zinc-200">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt={user.displayName} className="h-full w-full object-cover" />
                      ) : (
                        initialsForName(user.displayName)
                      )}
                    </span>
                    <span className="min-w-0 truncate">{user.displayName}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-between">
                <Button variant="secondary" onClick={handleLeave} data-testid="messages-leave-chat">Leave chat</Button>
                <Button variant="brand" onClick={handleAddMembers} data-testid="messages-add-members">Add selected</Button>
              </div>
              {membersError && <p className="text-sm text-red-600 dark:text-red-300">{membersError}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Name your team chat — first open by an owner, or rename later. */}
      {showNameModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={dismissNamePrompt} aria-hidden="true" />
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">Name your team chat</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-zinc-400">
              Message your whole company from one place. Everyone on your team will automatically be included.
            </p>
            <label className="mt-4 block text-sm font-medium text-gray-700 dark:text-zinc-300">Team chat name</label>
            <input
              type="text"
              value={teamChatName}
              onChange={(e) => setTeamChatName(e.target.value)}
              placeholder="e.g. Field Crew, Team Updates, [Business Name]"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-zinc-700 dark:bg-[#111111] dark:text-zinc-100"
              autoFocus
            />
            {companyName ? (
              <button
                type="button"
                onClick={() => setTeamChatName(companyName)}
                className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                Use {companyName}
              </button>
            ) : null}
            {namingError ? <p className="mt-3 text-sm text-red-600">{namingError}</p> : null}
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={dismissNamePrompt} disabled={namingSaving}>Cancel</Button>
              <Button variant="brand" onClick={saveTeamChatName} disabled={namingSaving || !teamChatName.trim()}>
                {namingSaving ? 'Saving…' : 'Create team chat'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
