/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
export function MessagesView({ employees = [], ui }) {
  const { Button, Icon, formatDate } = ui;
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
  const [availableUsers, setAvailableUsers] = useState([]);
  const [selectedNewChatUsers, setSelectedNewChatUsers] = useState([]);
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState([]);
  const [membersError, setMembersError] = useState('');
  const [selectedAddMembers, setSelectedAddMembers] = useState([]);
  const [myUserId, setMyUserId] = useState('');
  const [newIncomingCount, setNewIncomingCount] = useState(0);
  const [pendingDirectContact, setPendingDirectContact] = useState(null);
  const [forcedDirectLabels, setForcedDirectLabels] = useState({});
  const messagesEndRef = useRef(null);
  const previousUnreadRef = useRef(0);
  const channelsRef = useRef([]);

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  const normalized = (value) => String(value || '').trim().toLowerCase();
  const looksLikeDmName = useCallback(
    (value) => normalized(value).startsWith('dm-') || normalized(value) === 'direct message',
    []
  );

  const contactOptions = useMemo(() => {
    const userById = new Map((availableUsers || []).map((user) => [String(user.userId), user]));
    const options = [];

    for (const employee of employees || []) {
      const explicitUserId = employee?.user_id ? String(employee.user_id) : null;
      if (explicitUserId && myUserId && explicitUserId === myUserId) continue;
      const matchedUser = explicitUserId ? userById.get(explicitUserId) : null;
      const preferredLabel = matchedUser?.displayName || employee?.name || employee?.full_name || "Team Member";
      const preferredRole = matchedUser?.role || employee?.role || "";
      options.push({
        key: explicitUserId ? `user:${explicitUserId}` : `employee:${employee.id}`,
        label: String(preferredLabel),
        subtitle: String(preferredRole),
        userId: explicitUserId || null,
        hasAccount: Boolean(matchedUser || explicitUserId),
      });
    }

    for (const user of availableUsers || []) {
      if (myUserId && String(user.userId) === myUserId) continue;
      const key = `user:${user.userId}`;
      if (options.some((item) => item.key === key)) continue;
      options.push({
        key,
        label: String(user.displayName || 'Team Member'),
        subtitle: String(user.role || ''),
        userId: String(user.userId),
        hasAccount: true,
      });
    }

    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [availableUsers, employees, myUserId]);

  const userDisplayNameById = useMemo(
    () =>
      new Map(
        (availableUsers || []).map((user) => [String(user.userId), String(user.displayName || 'Team Member')])
      ),
    [availableUsers]
  );

  const getChannelDisplayName = useCallback(
    (channel) => {
      if (!channel) return 'Direct Message';
      const forcedLabel = forcedDirectLabels[String(channel.id || '')];
      if (forcedLabel) return String(forcedLabel);
      const isDirectChannel =
        String(channel.kind || '') === 'direct' ||
        Boolean(channel.other_user_id) ||
        looksLikeDmName(channel.name);
      if (!isDirectChannel) return String(channel.name || '');
      const otherUserId = String(channel.other_user_id || '');
      if (otherUserId && userDisplayNameById.has(otherUserId)) {
        return String(userDisplayNameById.get(otherUserId));
      }
      if (looksLikeDmName(channel.name)) return 'Direct Message';
      return String(channel.name || 'Direct Message');
    },
    [forcedDirectLabels, userDisplayNameById, looksLikeDmName]
  );

  const loadUsers = useCallback(async () => {
    const response = await fetch('/api/messages/users', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || 'Failed to load team members');
    setAvailableUsers(payload.items || []);
  }, []);

  const loadChannels = useCallback(async (silent = false) => {
    try {
      if (!silent) setChannelsLoading(true);
      setChannelsError('');
      const response = await fetch('/api/messages/inbox', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to load channels');
      const nextChannels = payload.items || [];
      setChannels(nextChannels);
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
      setMessages(payload.items || []);
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
      setMembers(payload.items || []);
    } catch (error) {
      setMembers([]);
      setMembersError(error instanceof Error ? error.message : 'Failed to load members');
    }
  }, []);

  useEffect(() => {
    supabaseBrowser().auth.getUser().then(({ data }) => {
      setMyUserId(String(data?.user?.id || ''));
    }).catch(() => setMyUserId(''));
  }, []);

  useEffect(() => {
    loadChannels();
    loadUsers().catch(() => setAvailableUsers([]));
  }, [loadChannels, loadUsers]);

  useEffect(() => {
    const refreshInbox = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      loadChannels(true);
    };

    const timer = setInterval(refreshInbox, 30000);
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', refreshInbox);
      document.addEventListener('visibilitychange', refreshInbox);
    }

    return () => {
      clearInterval(timer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', refreshInbox);
        document.removeEventListener('visibilitychange', refreshInbox);
      }
    };
  }, [loadChannels]);

  useEffect(() => {
    if (!activeChannel?.id) {
      setMessages([]);
      setMembers([]);
      return;
    }
    if (invalidChannelIds.includes(String(activeChannel.id))) {
      setActiveChannel(null);
      return;
    }
    setNewIncomingCount(0);
    loadMessages(activeChannel.id);
  }, [activeChannel, invalidChannelIds, loadMessages]);

  useEffect(() => {
    if (!showMembers || !activeChannel?.id) return;
    loadMembers(activeChannel.id);
  }, [showMembers, activeChannel, loadMembers]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const filteredChannels = channels
    .filter((channel) => {
      const isDirectChannel =
        String(channel.kind || '') === 'direct' ||
        Boolean(channel.other_user_id) ||
        looksLikeDmName(channel.name);
      if (!isDirectChannel) return true;
      if (String(activeChannel?.id || '') === String(channel.id)) return true;
      const hasPersonBinding =
        Boolean(channel.other_user_id) ||
        Boolean(forcedDirectLabels[String(channel.id || '')]);
      // Hide anonymous legacy direct threads (e.g., "Direct Message" / dm-*) that are not
      // bound to a specific teammate in this session.
      return hasPersonBinding && !looksLikeDmName(channel.name);
    })
    .filter((channel) => Number(channel.message_count || 0) > 0 || String(activeChannel?.id || '') === String(channel.id))
    .filter((channel) =>
      String(channel.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  const filteredContacts = contactOptions.filter(
    (contact) => contact.hasAccount && normalized(contact.label).includes(normalized(searchTerm))
  );

  const startDirectChat = async (contact) => {
    setCreateChannelError('');
    if (!contact.userId) {
      setCreateChannelError('This team member does not have an account yet');
      return;
    }
    const existing = channels.find(
      (channel) =>
        (String(channel.kind || '') === 'direct' || looksLikeDmName(channel.name)) &&
        String(channel.other_user_id || '') === String(contact.userId)
    );
    if (existing) {
      setForcedDirectLabels((prev) => ({
        ...prev,
        [String(existing.id)]: String(contact.label || 'Team Member'),
      }));
      setPendingDirectContact(null);
      setActiveChannel(existing);
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

      const generatedName =
        newChannelName.trim() ||
        `group-${Date.now()}`;

      const response = await fetch('/api/messages/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: generatedName, memberUserIds }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.item) throw new Error(payload?.error || 'Failed to create channel');
      setShowNewChannel(false);
      setNewChannelName('');
      setSelectedNewChatUsers([]);
      await loadChannels();
      setPendingDirectContact(null);
      setActiveChannel(payload.item);
    } catch (error) {
      setCreateChannelError(error instanceof Error ? error.message : 'Failed to create channel');
    } finally {
      setCreateChannelLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    try {
      setSendLoading(true);
      setSendError('');
      let channelId = activeChannel?.id ? String(activeChannel.id) : '';
      if (!channelId && pendingDirectContact?.userId) {
        const createResponse = await fetch('/api/messages/direct/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: pendingDirectContact.userId }),
        });
        const createPayload = await createResponse.json();
        if (!createResponse.ok || !createPayload?.item?.id) {
          throw new Error(createPayload?.error || 'Failed to create direct chat');
        }
        channelId = String(createPayload.item.id);
      }
      if (!channelId) return;

      const response = await fetch(`/api/messages/threads/${channelId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: messageText.trim() }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.item) throw new Error(payload?.error || 'Failed to send message');
      setMessageText('');
      await loadMessages(channelId);
      const nextChannels = await loadChannels();
      const pendingLabel = String(pendingDirectContact?.label || 'Team Member');
      const pendingUserId = String(pendingDirectContact?.userId || '');
      if (channelId) {
        setForcedDirectLabels((prev) => ({
          ...prev,
          [String(channelId)]: pendingLabel,
        }));
      }
      setPendingDirectContact(null);
      const refreshed = (nextChannels || []).find((channel) => String(channel.id) === String(channelId));
      if (refreshed) {
        const isDirect =
          String(refreshed.kind || '') === 'direct' ||
          Boolean(refreshed.other_user_id) ||
          looksLikeDmName(refreshed.name);
        const patched = isDirect
          ? {
              ...refreshed,
              other_user_id: refreshed.other_user_id || pendingUserId || null,
            }
          : refreshed;
        setActiveChannel(patched);
      }
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
    <div className="h-[calc(100vh-190px)] min-h-[700px] flex rounded-xl overflow-hidden border border-gray-800 bg-[#0d1016] shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
      <div className="w-full md:w-80 bg-[#0b0f14] border-r border-gray-800/80 flex flex-col">
        <div className="p-4 border-b border-gray-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-100 tracking-wide">Messages</h3>
            <Button variant="secondary" size="sm" onClick={() => setShowNewChannel(true)} data-testid="messages-create-channel-open">
              <Icon name="pen-to-square" />
            </Button>
          </div>
          {newIncomingCount > 0 && (
            <p className="text-xs text-emerald-300">
              {newIncomingCount} new message{newIncomingCount > 1 ? 's' : ''} received
            </p>
          )}
          <div className="relative">
            <Icon name="magnifying-glass" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs" />
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search" className="w-full pl-8 pr-3 py-2 bg-[#141922] border border-gray-800 rounded-lg text-sm text-gray-100 placeholder:text-gray-500 focus:ring-2 focus:ring-brand-500" />
          </div>
          {channelsError && <p className="text-sm text-red-400 mt-3">{channelsError}</p>}
        </div>
        <div className="flex-1 overflow-y-auto">
          {channelsLoading ? <div className="px-4 py-3 text-sm text-gray-400">Loading channels...</div> : filteredChannels.length === 0 ? <div className="px-4 py-3 text-sm text-gray-500">No channels yet.</div> : filteredChannels.map((channel) => (
            <button key={channel.id} onClick={() => { setActiveChannel(channel); setMessagesError(''); }} className={`w-full text-left px-4 py-3 border-b border-gray-800/70 hover:bg-[#151b26] ${activeChannel?.id === channel.id ? 'bg-brand-600/85' : ''}`} data-testid={`messages-channel-${channel.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`font-medium text-sm truncate ${activeChannel?.id === channel.id ? 'text-white' : 'text-gray-100'}`}>
                  {(String(channel.kind || '') === 'direct' || Boolean(channel.other_user_id) || looksLikeDmName(channel.name))
                    ? getChannelDisplayName(channel)
                    : `# ${channel.name}`}
                </span>
                {(channel.unread_count ?? channel.message_count) > 0 && <span className={`px-1.5 py-0.5 text-xs rounded-full ${activeChannel?.id === channel.id ? 'bg-white/20 text-white' : 'bg-gray-800 text-gray-300'}`}>{channel.unread_count ?? channel.message_count}</span>}
              </div>
              <p className={`text-xs truncate ${activeChannel?.id === channel.id ? 'text-white/80' : 'text-gray-500'}`}>{channel.last_message_preview || 'No messages yet'}</p>
            </button>
          ))}
          {pendingDirectContact && (
            <button
              type="button"
              onClick={() => setActiveChannel(null)}
              className="w-full text-left px-4 py-3 border-b border-gray-800/70 bg-brand-600/85"
              data-testid="messages-channel-pending-direct"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate text-white">{pendingDirectContact.label}</span>
              </div>
              <p className="text-xs truncate text-white/80">No messages yet</p>
            </button>
          )}
          <div className="px-4 py-3 border-t border-gray-800">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Team Members</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {filteredContacts.map((contact) => (
                <button
                  key={`contact-${contact.key}`}
                  type="button"
                  onClick={() => startDirectChat(contact)}
                  className="w-full text-left px-2 py-2 rounded-lg hover:bg-[#151b26] flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm text-gray-100 truncate">{contact.label}</p>
                    <p className="text-xs text-gray-500 truncate">{contact.subtitle || 'Team member'}</p>
                  </div>
                  <span className="text-[10px] text-gray-500">Chat</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {activeChannel ? (
        <div className="flex-1 flex flex-col bg-[#11151d]">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-[#0f131b]">
            <div>
              <h3 className="font-semibold text-gray-100" data-testid="messages-active-channel">
                {(String(activeChannel.kind || '') === 'direct' || Boolean(activeChannel.other_user_id) || looksLikeDmName(activeChannel.name))
                  ? getChannelDisplayName(activeChannel)
                  : `# ${activeChannel.name}`}
              </h3>
              <p className="text-xs text-gray-400">{activeChannel.message_count || 0} messages</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setShowMembers(true)} data-testid="messages-members-open">Members</Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 bg-gradient-to-b from-[#131824] to-[#0f131b]">
            {messagesLoading ? <div className="text-sm text-gray-400">Loading messages...</div> : messagesError ? <div className="text-sm text-red-400">{messagesError}</div> : messages.length === 0 ? <div className="text-sm text-gray-500">No messages yet.</div> : messages.map((msg) => {
              const isMine = myUserId && String(msg.sender_user_id || '') === String(myUserId);
              return (
                <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`} data-testid={`messages-message-${msg.id}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                    isMine ? 'bg-blue-500 text-white rounded-br-md' : 'bg-[#2a2f38] text-gray-100 rounded-bl-md'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                    <p className={`text-[10px] mt-1 ${isMine ? 'text-white/80' : 'text-gray-400'}`}>{formatDate(msg.created_at)}</p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="px-3 sm:px-6 py-3 sm:py-4 border-t border-gray-800 bg-[#0f131b]">
            <div className="flex items-end gap-3">
              <div className="flex-1 relative">
                <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder={(String(activeChannel.kind || '') === 'direct' || Boolean(activeChannel.other_user_id) || looksLikeDmName(activeChannel.name)) ? `Message ${getChannelDisplayName(activeChannel)}` : `Message #${activeChannel.name}`} className="w-full px-4 py-3 bg-[#161c27] border border-gray-800 rounded-xl text-sm text-gray-100 placeholder:text-gray-500 resize-none focus:ring-2 focus:ring-brand-500" rows="1" data-testid="messages-input" />
              </div>
              <button onClick={handleSendMessage} disabled={!messageText.trim() || sendLoading} className="p-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" data-testid="messages-send">
                <Icon name={sendLoading ? 'spinner' : 'paper-plane'} className={sendLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            {sendError && <p className="text-xs text-red-400 mt-2">{sendError}</p>}
            <p className="text-xs text-gray-500 mt-2">Press Enter to send, Shift + Enter for new line</p>
          </div>
        </div>
      ) : pendingDirectContact ? (
        <div className="flex-1 flex flex-col bg-[#11151d]">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-[#0f131b]">
            <div>
              <h3 className="font-semibold text-gray-100">Message {pendingDirectContact.label}</h3>
              <p className="text-xs text-gray-400">No messages yet</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gradient-to-b from-[#131824] to-[#0f131b]">
            <div className="text-sm text-gray-500">Send the first message to start this chat.</div>
          </div>
          <div className="px-3 sm:px-6 py-3 sm:py-4 border-t border-gray-800 bg-[#0f131b]">
            <div className="flex items-end gap-3">
              <div className="flex-1 relative">
                <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder={`Message ${pendingDirectContact.label}`} className="w-full px-4 py-3 bg-[#161c27] border border-gray-800 rounded-xl text-sm text-gray-100 placeholder:text-gray-500 resize-none focus:ring-2 focus:ring-brand-500" rows="1" data-testid="messages-input" />
              </div>
              <button onClick={handleSendMessage} disabled={!messageText.trim() || sendLoading} className="p-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" data-testid="messages-send">
                <Icon name={sendLoading ? 'spinner' : 'paper-plane'} className={sendLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            {sendError && <p className="text-xs text-red-400 mt-2">{sendError}</p>}
            <p className="text-xs text-gray-500 mt-2">Press Enter to send, Shift + Enter for new line</p>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center bg-[#11151d]"><div className="text-center"><h3 className="text-lg font-semibold text-gray-100 mb-2">Your Messages</h3></div></div>
      )}

      {showNewChannel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Create Group Chat</h3>
              <button onClick={() => setShowNewChannel(false)} className="p-1 text-gray-400 hover:text-gray-600"><Icon name="xmark" /></button>
            </div>
            <div className="p-6 space-y-3 max-h-[70vh] overflow-y-auto">
              <label className="block text-sm font-medium text-gray-700">Group Name (optional for direct chat)</label>
              <input type="text" value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} placeholder="e.g. field-updates" className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500" data-testid="messages-create-channel-input" />
              <label className="block text-sm font-medium text-gray-700">Add Members</label>
              <div className="border border-gray-200 rounded-lg p-2 max-h-48 overflow-y-auto space-y-2" data-testid="messages-create-channel-members">
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
                    <span>{contact.label}</span>
                  </label>
                ))}
              </div>
              {createChannelError && <p className="text-sm text-red-600">{createChannelError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setShowNewChannel(false)} disabled={createChannelLoading}>Cancel</Button>
                <Button variant="brand" onClick={handleCreateChannel} disabled={createChannelLoading} data-testid="messages-create-channel-submit">{createChannelLoading ? 'Creating...' : 'Create'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showMembers && activeChannel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="messages-members-modal">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Members</h3>
              <button onClick={() => setShowMembers(false)} className="p-1 text-gray-400 hover:text-gray-600"><Icon name="xmark" /></button>
            </div>
            <div className="p-6 space-y-3 max-h-[70vh] overflow-y-auto">
              {members.map((member) => (
                <div key={member.id} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2">
                  <span>{member.displayName} {member.memberRole === 'owner' ? '(owner)' : ''}</span>
                  {member.memberRole !== 'owner' && <Button variant="secondary" size="sm" onClick={() => handleRemoveMember(member.userId)} data-testid={`messages-member-remove-${member.userId}`}>Remove</Button>}
                </div>
              ))}
              <label className="block text-sm font-medium text-gray-700">Add Members</label>
              <div className="border border-gray-200 rounded-lg p-2 max-h-40 overflow-y-auto space-y-2">
                {availableUsers.map((user) => (
                  <label key={user.userId} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selectedAddMembers.includes(user.userId)} onChange={(e) => setSelectedAddMembers((prev) => e.target.checked ? [...prev, user.userId] : prev.filter((id) => id !== user.userId))} />
                    <span>{user.displayName}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-between">
                <Button variant="secondary" onClick={handleLeave} data-testid="messages-leave-chat">Leave chat</Button>
                <Button variant="brand" onClick={handleAddMembers} data-testid="messages-add-members">Add selected</Button>
              </div>
              {membersError && <p className="text-sm text-red-600">{membersError}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
