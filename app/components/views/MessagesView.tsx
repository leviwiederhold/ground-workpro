/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @next/next/no-img-element */
// @ts-nocheck
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { MobileSheet } from '@/app/components/ui/MobileSheet';

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
  const [members, setMembers] = useState([]);
  const [membersError, setMembersError] = useState('');
  const [selectedAddMembers, setSelectedAddMembers] = useState([]);
  const [myUserId, setMyUserId] = useState('');
  const [newIncomingCount, setNewIncomingCount] = useState(0);
  const [pendingDirectContact, setPendingDirectContact] = useState(null);
  const [forcedDirectLabels, setForcedDirectLabels] = useState({});
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  // Company-wide chat naming
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [showNameModal, setShowNameModal] = useState(false);
  const [teamChatName, setTeamChatName] = useState('');
  const [namingSaving, setNamingSaving] = useState(false);
  const [namingError, setNamingError] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const previousUnreadRef = useRef(0);
  const channelsRef = useRef([]);
  const resolvedDirectChannelIdsRef = useRef(new Set());
  const safeEmployees = useMemo(
    () => (Array.isArray(employees) ? employees.filter(hasRecordId) : []),
    [employees]
  );

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  // Clear any composed attachments when switching threads so files are never
  // sent to the wrong conversation; revoke their object URLs to avoid leaks.
  useEffect(() => {
    setPendingAttachments((prev) => {
      prev.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
      return [];
    });
  }, [activeChannel?.id, pendingDirectContact?.userId]);

  useEffect(() => {
    if (!Array.isArray(availableUsersSeed) || availableUsersSeed.length === 0) return;
    setAvailableUsers((current) => (current.length > 0 ? current : availableUsersSeed.filter(hasUserId)));
  }, [availableUsersSeed]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const activeChannelId = String(activeChannel?.id || '');

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
    [forcedDirectLabels, isGroupChannel, isDirectChannel, userDisplayNameById, contactDisplayNameByUserId, looksLikeDmName]
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

  const loadMessages = useCallback(async (channelId) => {
    try {
      setMessagesLoading(true);
      setMessagesError('');
      const response = await fetch(`/api/messages/threads/${channelId}/messages`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to load messages');
      setMessages(Array.isArray(payload?.items) ? payload.items.filter(hasRecordId) : []);
      await markThreadRead(channelId);
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
      setMessages([]);
      setMessagesError(errorMessage);
    } finally {
      setMessagesLoading(false);
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

  // Default conversation: open the permanent Companywide chat when Messaging
  // first loads and nothing is selected yet (once).
  const didDefaultSelectRef = useRef(false);
  useEffect(() => {
    if (didDefaultSelectRef.current) return;
    if (activeChannel) {
      didDefaultSelectRef.current = true;
      return;
    }
    const companywide = (channels || []).find((c) => c && c.is_companywide);
    if (companywide) {
      didDefaultSelectRef.current = true;
      setActiveChannel(companywide);
    }
  }, [channels, activeChannel]);

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
    loadMessages(activeChannelId);
  }, [activeChannelId, invalidChannelIds, loadMessages]);

  useEffect(() => {
    if (!showMembers || !activeChannelId) return;
    loadMembers(activeChannelId);
  }, [showMembers, activeChannelId, loadMembers]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const filteredChannels = channels
    .filter((channel) =>
      String(getChannelDisplayName(channel) || channel.name || '')
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    );
  const directChannelByUserId = useMemo(() => {
    const map = new Map();
    for (const channel of channels) {
      if (!isDirectChannel(channel)) continue;
      const key = String(channel.other_user_id || '').trim();
      if (!key) continue;
      map.set(key, channel);
    }
    return map;
  }, [channels, isDirectChannel]);
  const filteredContacts = contactOptions.filter(
    (contact) => contact.hasAccount && normalized(contact.label).includes(normalized(searchTerm))
  );
  const showConversationPanel = Boolean(activeChannel || pendingDirectContact);

  const startDirectChat = async (contact) => {
    setCreateChannelError('');
    if (!contact.userId) {
      setCreateChannelError('This team member does not have an account yet');
      return;
    }
    const existing = directChannelByUserId.get(String(contact.userId));
    if (existing) {
      setForcedDirectLabels((prev) => ({
        ...prev,
        [String(existing.id)]: String(contact.label || 'Team Member'),
      }));
      setActiveChannel(existing);
      setPendingDirectContact(null);
      return;
    }
    setActiveChannel(null);
    setPendingDirectContact({
      userId: String(contact.userId),
      label: String(contact.label || 'Team Member'),
    });
  };

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
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

  const formatFileSize = (bytes) => {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImageAttachment = (att) =>
    Boolean(att?.is_image) || String(att?.content_type || '').toLowerCase().startsWith('image/');

  const iconForContentType = (contentType) => {
    const t = String(contentType || '').toLowerCase();
    if (t.startsWith('image/')) return 'image';
    if (t.includes('pdf')) return 'file-pdf';
    if (t.includes('word') || t.includes('msword')) return 'file-word';
    if (t.includes('sheet') || t.includes('excel') || t.includes('csv')) return 'file-excel';
    return 'file';
  };

  const handleFilesSelected = (fileList) => {
    setSendError('');
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;
    setPendingAttachments((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        if (next.length >= MAX_ATTACHMENTS) {
          setSendError(`You can attach at most ${MAX_ATTACHMENTS} files.`);
          break;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setSendError(`"${file.name}" is larger than 10 MB.`);
          continue;
        }
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
          file,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
        });
      }
      return next;
    });
  };

  const removePendingAttachment = (id) => {
    setPendingAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const clearPendingAttachments = () => {
    setPendingAttachments((prev) => {
      prev.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
      return [];
    });
  };

  const openAttachmentPicker = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const renderComposerAttachments = () => (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
        className="hidden"
        onChange={(e) => {
          handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
        data-testid="messages-attach-input"
      />
      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" data-testid="messages-attachment-previews">
          {pendingAttachments.map((att) => (
            <div key={att.id} className="relative flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1.5 pr-7 dark:border-zinc-800 dark:bg-[#111111]">
              {att.previewUrl ? (
                <img src={att.previewUrl} alt={att.file.name} className="h-10 w-10 rounded object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded bg-gray-200 text-gray-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <Icon name={iconForContentType(att.file.type)} />
                </span>
              )}
              <div className="min-w-0 max-w-[9rem]">
                <p className="truncate text-xs font-medium text-gray-800 dark:text-zinc-200">{att.file.name}</p>
                <p className="text-[10px] text-gray-500 dark:text-zinc-500">{formatFileSize(att.file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => removePendingAttachment(att.id)}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-zinc-700"
                aria-label={`Remove ${att.file.name}`}
              >
                <Icon name="xmark" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const renderAttachButton = () => (
    <button
      type="button"
      onClick={openAttachmentPicker}
      disabled={sendLoading || pendingAttachments.length >= MAX_ATTACHMENTS}
      className="shrink-0 rounded-xl p-2.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-[#111111]"
      title="Attach photos or files"
      data-testid="messages-attach-button"
    >
      <Icon name="paperclip" />
    </button>
  );

  const renderMessageAttachments = (msg, isMine) => {
    const list = Array.isArray(msg?.attachments) ? msg.attachments : [];
    if (list.length === 0) return null;
    return (
      <div className="mt-2 flex flex-col gap-2">
        {list.map((att) =>
          isImageAttachment(att) && att.download_url ? (
            <a key={att.id} href={att.download_url} target="_blank" rel="noopener noreferrer" className="block">
              <img
                src={att.download_url}
                alt={att.file_name || 'Image attachment'}
                className="max-h-64 w-auto max-w-full rounded-lg border border-black/5 object-cover dark:border-white/10"
                loading="lazy"
              />
            </a>
          ) : (
            <a
              key={att.id}
              href={att.download_url || undefined}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-3 rounded-lg border p-2.5 no-underline ${
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
          )
        )}
      </div>
    );
  };

  const handleSendMessage = async () => {
    const trimmedText = messageText.trim();
    if (!trimmedText && pendingAttachments.length === 0) return;
    try {
      setSendLoading(true);
      setSendError('');
      let channelId = activeChannel?.id ? String(activeChannel.id) : '';
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
      }
      if (!channelId) return;

      const hasAttachments = pendingAttachments.length > 0;
      let response;
      if (hasAttachments) {
        const formData = new FormData();
        formData.append('body', trimmedText);
        pendingAttachments.forEach((att) => formData.append('files', att.file, att.file.name));
        response = await fetch(`/api/messages/threads/${channelId}/send`, {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch(`/api/messages/threads/${channelId}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: trimmedText }),
        });
      }
      const payload = await response.json();
      // On failure we intentionally keep messageText + pendingAttachments so the
      // composed message is never silently lost.
      if (!response.ok || !payload?.item) throw new Error(payload?.error || 'Failed to send message');
      const sentBody = trimmedText;
      const attachmentCount = pendingAttachments.length;
      setMessageText('');
      clearPendingAttachments();
      const pendingLabel = String(pendingDirectContact?.label || 'Team Member');
      const pendingUserId = String(pendingDirectContact?.userId || '');
      setMessages((prev) => [
        ...prev,
        {
          ...payload.item,
          attachments: Array.isArray(payload.item.attachments) ? payload.item.attachments : [],
          sender_display_name: 'You',
          sender_avatar_url: '',
        },
      ]);
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
      if (channelId) {
        setForcedDirectLabels((prev) => ({
          ...prev,
          [String(channelId)]: pendingLabel,
        }));
      }
      setPendingDirectContact(null);
      setActiveChannel((current) => ({
        ...(current && String(current.id) === String(channelId) ? current : activeChannel || {}),
        id: channelId,
        kind: pendingUserId ? 'direct' : String(activeChannel?.kind || 'group'),
        name: pendingLabel || String(activeChannel?.name || ''),
        other_user_id: pendingUserId || activeChannel?.other_user_id || null,
        message_count: Number(activeChannel?.message_count || 0) + 1,
      }));
      loadChannels(true);
    } catch (error) {
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

  return (
    <div className="flex h-[calc(100dvh-var(--mobile-header-total-height)-var(--mobile-safe-bottom)-1.5rem)] min-h-0 w-full max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.08)] dark:border-zinc-800 dark:bg-[#050505] dark:shadow-[0_18px_40px_rgba(0,0,0,0.45)] md:h-[calc(100dvh-170px)] md:min-h-[700px]" data-testid="messages-root">
      <div className={`min-w-0 w-full md:w-80 md:shrink-0 bg-white border-r border-gray-200 dark:border-zinc-800 dark:bg-[#090909] flex-col ${showConversationPanel ? 'hidden md:flex' : 'flex'}`} data-testid="messages-sidebar">
        <div className="space-y-3 border-b border-gray-200 p-4 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold tracking-wide text-gray-900 dark:text-zinc-100">Messages</h3>
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
          <div className="flex min-h-0 flex-1 flex-col border-t border-gray-100 px-4 py-3 dark:border-zinc-900">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-gray-500 dark:text-zinc-500">Team Members</p>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" data-testid="messages-team-members-list">
              {filteredContacts.map((contact) => {
                const directChannel = contact.userId ? directChannelByUserId.get(String(contact.userId)) : null;
                const isActiveDirect =
                  Boolean(directChannel) && String(activeChannel?.id || '') === String(directChannel?.id || '');
                const preview = directChannel?.last_message_at
                  ? formatThreadSubtextTime(directChannel.last_message_at)
                  : (directChannel?.last_message_preview || contact.subtitle || 'Team member');
                return (
                <button
                  key={`contact-${contact.key}`}
                  type="button"
                  onClick={() => startDirectChat(contact)}
                  className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-[#131313] ${
                    isActiveDirect ? 'border border-brand-200 bg-brand-50 dark:border-brand-900/60 dark:bg-brand-950/30' : ''
                  }`}
                  data-testid={`messages-contact-${contact.key}`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 text-[11px] font-semibold text-gray-700 dark:bg-zinc-800 dark:text-zinc-200">
                      {contact.avatarUrl ? (
                        <img src={contact.avatarUrl} alt={contact.label} className="h-full w-full object-cover" />
                      ) : (
                        initialsForName(contact.label)
                      )}
                    </span>
                    <div className="min-w-0">
                    <p className="truncate text-sm text-gray-900 dark:text-zinc-100">{contact.label}</p>
                    <p className="truncate text-xs text-gray-500 dark:text-zinc-400">{preview}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-gray-500 dark:text-zinc-500">Chat</span>
                </button>
              )})}
            </div>
          </div>
        </div>
      </div>

      {activeChannel ? (
        <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-[#050505]" data-testid="messages-thread">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-[#090909] sm:px-6 sm:py-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                className="shrink-0 rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-700 dark:border-zinc-700 dark:text-zinc-200 md:hidden"
                onClick={() => {
                  setActiveChannel(null);
                  setPendingDirectContact(null);
                }}
              >
                Back
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
              <p className="text-xs text-gray-500 dark:text-zinc-400">{activeChannel.message_count || 0} messages</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {activeChannel.is_companywide && viewerIsAdmin && (
                <Button variant="secondary" size="sm" onClick={openRenameTeamChat} data-testid="messages-rename-companywide">Rename</Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setShowMembers(true)} data-testid="messages-members-open">Members</Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden bg-gray-50/40 p-3 dark:bg-[#050505] sm:p-6">
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
                    <div className={`flex max-w-[min(82%,36rem)] min-w-0 ${isMine ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
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
                    <div className={`max-w-full rounded-2xl px-4 py-2.5 ${
                      isMine
                        ? 'rounded-br-md bg-brand-600 text-white dark:bg-brand-500'
                        : 'rounded-bl-md border border-zinc-800 bg-[#111111] text-zinc-100'
                    }`}>
                      {msg.body ? <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p> : null}
                      {renderMessageAttachments(msg, isMine)}
                      <p className={`mt-1 text-[10px] ${isMine ? 'text-white/80' : 'text-gray-500 dark:text-zinc-400'}`}>{formatMessageTime(msg.created_at)}</p>
                    </div>
                    </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 border-t border-gray-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-[#090909] sm:px-6 sm:py-4">
            {renderComposerAttachments()}
            <div className="flex min-w-0 items-end gap-2 sm:gap-3">
              {renderAttachButton()}
              <div className="relative min-w-0 flex-1">
                <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder={isDirectChannel(activeChannel) ? `Message ${getChannelDisplayName(activeChannel)}` : activeChannel.is_companywide ? (companyName ? `Send a message to everyone in ${companyName}` : 'Message your team') : `Message #${activeChannel.name}`} className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-brand-500 dark:border-zinc-800 dark:bg-[#111111] dark:text-zinc-100 dark:placeholder:text-zinc-500" rows="1" data-testid="messages-input" />
              </div>
              <button onClick={handleSendMessage} disabled={(!messageText.trim() && pendingAttachments.length === 0) || sendLoading} className="shrink-0 p-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" data-testid="messages-send">
                <Icon name={sendLoading ? 'spinner' : 'paper-plane'} className={sendLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            {sendError && <p className="mt-2 text-xs text-red-500 dark:text-red-300">{sendError}</p>}
            <p className="mt-2 text-xs text-gray-500 dark:text-zinc-500">Press Enter to send, Shift + Enter for new line</p>
          </div>
        </div>
      ) : pendingDirectContact ? (
        <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-[#050505]" data-testid="messages-thread">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-[#090909] sm:px-6 sm:py-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                className="shrink-0 rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-700 dark:border-zinc-700 dark:text-zinc-200 md:hidden"
                onClick={() => setPendingDirectContact(null)}
              >
                Back
              </button>
              <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold text-gray-900 dark:text-zinc-100">Message {pendingDirectContact.label}</h3>
              <p className="text-xs text-gray-500 dark:text-zinc-400">No messages yet</p>
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-gray-50/40 p-3 dark:bg-[#050505] sm:p-6">
            <div className="text-sm text-gray-500 dark:text-zinc-400">Send the first message to start this chat.</div>
          </div>
          <div className="shrink-0 border-t border-gray-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-[#090909] sm:px-6 sm:py-4">
            {renderComposerAttachments()}
            <div className="flex min-w-0 items-end gap-2 sm:gap-3">
              {renderAttachButton()}
              <div className="relative min-w-0 flex-1">
                <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder={`Message ${pendingDirectContact.label}`} className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-brand-500 dark:border-zinc-800 dark:bg-[#111111] dark:text-zinc-100 dark:placeholder:text-zinc-500" rows="1" data-testid="messages-input" />
              </div>
              <button onClick={handleSendMessage} disabled={(!messageText.trim() && pendingAttachments.length === 0) || sendLoading} className="shrink-0 p-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" data-testid="messages-send">
                <Icon name={sendLoading ? 'spinner' : 'paper-plane'} className={sendLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            {sendError && <p className="mt-2 text-xs text-red-500 dark:text-red-300">{sendError}</p>}
            <p className="mt-2 text-xs text-gray-500 dark:text-zinc-500">Press Enter to send, Shift + Enter for new line</p>
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
