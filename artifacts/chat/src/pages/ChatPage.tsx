import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { 
  Shield, 
  Send, 
  Lock, 
  Search, 
  LogOut, 
  KeyRound, 
  AlertCircle,
  MessageSquareOff,
  UserCircle,
  Check,
  ShieldAlert,
  Users,
  Plus
} from "lucide-react";

import { 
  useListUsers, 
  useGetMessages, 
  useGetUnreadMessages, 
  useGetPublicKey,
  getPublicKey,
  type Message as ApiMessage,
  customFetch
} from "@workspace/api-client-react";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

import { getToken, getMe, removeToken, removeMe } from "@/lib/auth";
import { 
  connectWS, 
  disconnectWS, 
  onMessage, 
  onStatusChange, 
  sendWSMessage,
  onDelivered,
  onRead,
  sendReadReceipt
} from "@/lib/websocket";
import { 
  loadPrivateKey, 
  decryptMessage, 
  importPublicKey, 
  encryptMessage,
  encryptGroupMessage,
  deletePrivateKey 
} from "@/lib/crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

type DecryptedMessage = ApiMessage & {
  groupId?: number;
  decryptedContent?: string;
  decryptionError?: boolean;
};

// Per-message tick state tracked client-side
type TickStatus = "sent" | "delivered" | "read";

// ── Tick Icon Component ───────────────────────────────────────────────────────

function MessageTicks({ status }: { status: TickStatus }) {
  if (status === "sent") {
    // Single grey tick
    return (
      <span className="inline-flex items-center ml-1 opacity-60" title="Sent">
        <Check className="w-3 h-3 text-primary-foreground/70" />
      </span>
    );
  }
  if (status === "delivered") {
    // Double grey tick
    return (
      <span className="inline-flex items-center ml-1 -space-x-1.5 opacity-60" title="Delivered">
        <Check className="w-3 h-3 text-primary-foreground/70" />
        <Check className="w-3 h-3 text-primary-foreground/70" />
      </span>
    );
  }
  // Read — double blue tick
  return (
    <span className="inline-flex items-center ml-1 -space-x-1.5" title="Read">
      <Check className="w-3 h-3 text-sky-300" />
      <Check className="w-3 h-3 text-sky-300" />
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const me = getMe();

  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const selectedUserRef = useRef<string | null>(null);
  selectedUserRef.current = selectedUser;

  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const selectedGroupIdRef = useRef<number | null>(null);
  selectedGroupIdRef.current = selectedGroupId;

  const [activeTab, setActiveTab] = useState<"direct" | "group">("direct");
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);

  const [messages, setMessages] = useState<Record<string, DecryptedMessage[]>>({});
  const messageInputRef = useRef(""); // Track input for draft preservation
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Real-time status map overrides
  const [liveStatuses, setLiveStatuses] = useState<Record<string, boolean>>({});
  const [isSending, setIsSending] = useState(false);
  const [privateKeyMissing, setPrivateKeyMissing] = useState(false);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);

  // Per-message-id tick status (only for messages sent by me)
  const [tickMap, setTickMap] = useState<Record<number, TickStatus>>({});

  // Panic Wipe states
  const [isWiping, setIsWiping] = useState(false);
  const [wipeProgress, setWipeProgress] = useState(0);
  const [wipeTerminalLogs, setWipeTerminalLogs] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input + send read receipt when a contact is selected
  const handleSelectUser = useCallback((username: string) => {
    setSelectedUser(username);
    setSelectedGroupId(null);
    // Tell the server we've read all their messages
    sendReadReceipt(username);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSelectGroup = useCallback((groupId: number) => {
    setSelectedGroupId(groupId);
    setSelectedUser(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handlePanicWipe = useCallback(async () => {
    if (isWiping || !me) return;
    setIsWiping(true);
    setWipeProgress(0);
    setWipeTerminalLogs(["[!] PANIC PROTOCOL INITIATED..."]);

    const addLog = (msg: string, delay: number) => {
      return new Promise<void>(res => {
        setTimeout(() => {
          setWipeTerminalLogs(prev => [...prev, msg]);
          res();
        }, delay);
      });
    };

    // Visual progress bar ticks
    const interval = setInterval(() => {
      setWipeProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + 10;
      });
    }, 100);

    // Cryptographic & Session Wipe
    try {
      await addLog("[!] SEVERING WS CHANNEL CONNECTION...", 150);
      disconnectWS();

      await addLog("[!] DELETING LOCAL VAULT KEYS FROM STORAGE...", 300);
      await deletePrivateKey(me.username);

      await addLog("[!] PURGING LOCAL AUTHENTICATION TOKENS...", 250);
      removeToken();
      removeMe();

      await addLog("[!] STORAGE WIPED. VAULT RENDERED INACCESSIBLE.", 300);
      await addLog("[!] SHUTTING DOWN WORKSPACE...", 200);

      // Hold for 300ms before redirecting
      setTimeout(() => {
        clearInterval(interval);
        setLocation("/login");
      }, 300);

    } catch (err) {
      console.error("Wipe failed:", err);
      // Fallback raw clear
      localStorage.clear();
      indexedDB.deleteDatabase("securechat");
      removeToken();
      removeMe();
      setLocation("/login");
    }
  }, [me, isWiping, setLocation]);

  // Keyboard shortcut for Panic Wipe (Ctrl + Shift + W)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === "W") {
        e.preventDefault();
        handlePanicWipe();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePanicWipe]);

  // 1. Initial auth & websocket setup
  useEffect(() => {
    const token = getToken();
    if (!token || !me) {
      setLocation("/login");
      return;
    }

    // Request desktop notification permission on login/mount
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    // Load private key
    loadPrivateKey(me.username).then(key => {
      if (!key) {
        setPrivateKeyMissing(true);
      } else {
        setPrivateKey(key);
      }
    }).catch(() => {
      setPrivateKeyMissing(true);
    });

    connectWS(token);

    const unsubs = [
      onStatusChange((username, online) => {
        setLiveStatuses(prev => ({ ...prev, [username]: online }));
      }),

      onMessage(async (rawMsg: ApiMessage) => {
        if (!me) return;
        const msg = rawMsg as any;

        // Group message handling
        if (msg.groupId) {
          const threadKey = `group_${msg.groupId}`;
          let decrypted: DecryptedMessage = { ...msg };
          try {
            const keyToUse = await loadPrivateKey(me.username);
            if (keyToUse && msg.encryptedKey && msg.iv) {
              decrypted.decryptedContent = await decryptMessage(
                msg.encryptedContent, msg.encryptedKey, msg.iv, keyToUse
              );
            } else {
              decrypted.decryptionError = true;
            }
          } catch {
            decrypted.decryptionError = true;
          }

          setMessages(prev => {
            const thread = prev[threadKey] || [];
            if (thread.some(m => m.id === msg.id)) return prev;
            return {
              ...prev,
              [threadKey]: [...thread, decrypted].sort(
                (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
              )
            };
          });

          // In-app group notification if not looking at this group thread
          if (msg.fromUsername !== me.username) {
            const activeGroupId = selectedGroupIdRef.current;
            if (msg.groupId !== activeGroupId) {
              toast({
                title: `💬 New message in group`,
                description: `${msg.fromUsername}: ${decrypted.decryptedContent || "🔒 Encrypted content"}`,
                duration: 4000,
              });
            }
          }
          return;
        }

        // Direct message handling (fallback)
        const partner = msg.fromUsername === me.username ? msg.toUsername! : msg.fromUsername;

        let decrypted: DecryptedMessage = { ...msg };
        try {
          const keyToUse = await loadPrivateKey(me.username);
          if (keyToUse && msg.encryptedKey && msg.iv) {
            decrypted.decryptedContent = await decryptMessage(
              msg.encryptedContent, msg.encryptedKey, msg.iv, keyToUse
            );
          } else {
            decrypted.decryptionError = true;
          }
        } catch {
          decrypted.decryptionError = true;
        }

        setMessages(prev => {
          const thread = prev[partner] || [];
          if (thread.some(m => m.id === msg.id)) return prev;
          return {
            ...prev,
            [partner]: [...thread, decrypted].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            )
          };
        });

        // Seed initial tick state from server flags
        if (msg.fromUsername === me.username) {
          setTickMap(prev => ({
            ...prev,
            [msg.id]: msg.read ? "read" : msg.delivered ? "delivered" : "sent"
          }));
        }

        // Handle incoming message notifications (only if it's from another user)
        if (msg.fromUsername !== me.username) {
          const activeUser = selectedUserRef.current;
          
          if (msg.fromUsername !== activeUser) {
            // In-app Toast alert
            toast({
              title: `💬 Secure message from ${msg.fromUsername}`,
              description: decrypted.decryptedContent || "🔒 Encrypted content received",
              duration: 4000,
            });

            // Browser desktop notification if tab is in the background
            if (document.hidden && "Notification" in window && Notification.permission === "granted") {
              new Notification(`🔒 Secure Message from ${msg.fromUsername}`, {
                body: decrypted.decryptedContent || "Encrypted message content",
              });
            }
          } else {
            // Auto-read if we are currently looking at the chat
            sendReadReceipt(msg.fromUsername);
          }
        }
      }),

      // Server says one of our messages was delivered
      onDelivered((msgId) => {
        setTickMap(prev => {
          if (prev[msgId] === "read") return prev; // don't downgrade
          return { ...prev, [msgId]: "delivered" };
        });
      }),

      // Server says one of our messages was read
      onRead((msgIds) => {
        setTickMap(prev => {
          const next = { ...prev };
          msgIds.forEach(id => { next[id] = "read"; });
          return next;
        });
      }),
    ];

    return () => {
      unsubs.forEach(fn => fn());
      disconnectWS();
    };
  }, [setLocation, me?.username]); // eslint-disable-line react-hooks/exhaustive-deps

  // Also send a read receipt whenever selectedUser changes (tab switch)
  useEffect(() => {
    if (selectedUser) sendReadReceipt(selectedUser);
  }, [selectedUser]);

  // Queries
  const { data: usersData, isLoading: usersLoading } = useListUsers({
    query: {
      refetchInterval: 1000,
      refetchIntervalInBackground: false,
    } as any
  });

  const { data: historyData, isLoading: historyLoading } = useGetMessages(selectedUser || "", {
    query: {
      enabled: !!selectedUser && !privateKeyMissing && !!privateKey,
      refetchInterval: 1000,
      refetchIntervalInBackground: false,
    } as any
  });

  const { data: unreadData } = useGetUnreadMessages({
    query: {
      enabled: !privateKeyMissing && !!privateKey,
      refetchInterval: 1000,
      refetchIntervalInBackground: false,
    } as any
  });

  const { data: groupsData, refetch: refetchGroups } = useQuery<any[]>({
    queryKey: ["groups"],
    queryFn: async () => {
      const res = await customFetch("/groups");
      return res as any[];
    },
    refetchInterval: 2000,
    enabled: !privateKeyMissing && !!privateKey,
  });

  const { data: groupMessagesData, isLoading: groupMessagesLoading } = useQuery<any[]>({
    queryKey: ["groupMessages", selectedGroupId],
    queryFn: async () => {
      if (!selectedGroupId) return [];
      const res = await customFetch(`/groups/${selectedGroupId}/messages`);
      return res as any[];
    },
    enabled: !!selectedGroupId && !privateKeyMissing && !!privateKey,
    refetchInterval: 1000,
  });

  // Last message per conversation for sidebar preview
  const lastMessageMap = useMemo(() => {
    const map: Record<string, DecryptedMessage> = {};
    for (const [partner, thread] of Object.entries(messages)) {
      if (thread.length > 0) map[partner] = thread[thread.length - 1];
    }
    return map;
  }, [messages]);

  // Unread counts map per contact based on unreadData query
  const unreadCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (!unreadData) return map;
    for (const msg of unreadData) {
      if (msg.fromUsername !== me?.username && msg.fromUsername !== selectedUser) {
        map[msg.fromUsername] = (map[msg.fromUsername] || 0) + 1;
      }
    }
    return map;
  }, [unreadData, selectedUser, me?.username]);

  // Combine server status with real-time status, sort by most recent message
  const users = useMemo(() => {
    if (!usersData) return [];
    return usersData
      .filter(u => u.username !== me?.username)
      .map(u => ({
        ...u,
        online: liveStatuses[u.username] !== undefined ? liveStatuses[u.username] : u.online
      }))
      .filter(u => u.username.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        const aTime = lastMessageMap[a.username]?.timestamp
          ? new Date(lastMessageMap[a.username].timestamp).getTime()
          : ((a as any).lastMessageAt ? new Date((a as any).lastMessageAt).getTime() : (a.lastSeen ? new Date(a.lastSeen).getTime() : 0));
        const bTime = lastMessageMap[b.username]?.timestamp
          ? new Date(lastMessageMap[b.username].timestamp).getTime()
          : ((b as any).lastMessageAt ? new Date((b as any).lastMessageAt).getTime() : (b.lastSeen ? new Date(b.lastSeen).getTime() : 0));
        return bTime - aTime; // most recent first
      });
  }, [usersData, liveStatuses, searchQuery, me?.username, lastMessageMap]);

  // Decrypt history when loaded
  useEffect(() => {
    if (!selectedUser || !historyData || !privateKey) return;

    const decryptHistory = async () => {
      const decryptedMsgs: DecryptedMessage[] = [];
      const newTicks: Record<number, TickStatus> = {};

      for (const msg of historyData) {
        let dec: DecryptedMessage = { ...msg };
        try {
          if (msg.encryptedKey && msg.iv) {
            dec.decryptedContent = await decryptMessage(
              msg.encryptedContent, msg.encryptedKey, msg.iv, privateKey
            );
          } else {
            dec.decryptionError = true;
          }
        } catch {
          dec.decryptionError = true;
        }
        decryptedMsgs.push(dec);

        // Seed ticks from DB flags for messages we sent
        if (msg.fromUsername === me?.username) {
          newTicks[msg.id] = msg.read ? "read" : msg.delivered ? "delivered" : "sent";
        }
      }

      setMessages(prev => ({ ...prev, [selectedUser]: decryptedMsgs }));
      setTickMap(prev => ({ ...prev, ...newTicks }));
    };

    decryptHistory();
  }, [historyData, selectedUser, privateKey, me?.username]);

  // Decrypt group messages when loaded
  useEffect(() => {
    if (!selectedGroupId || !groupMessagesData || !privateKey) return;

    const decryptGroupMsgs = async () => {
      const decryptedMsgs: DecryptedMessage[] = [];

      for (const msg of groupMessagesData) {
        let dec: DecryptedMessage = { ...msg };
        try {
          if (msg.encryptedKey && msg.iv) {
            dec.decryptedContent = await decryptMessage(
              msg.encryptedContent, msg.encryptedKey, msg.iv, privateKey
            );
          } else {
            dec.decryptionError = true;
          }
        } catch {
          dec.decryptionError = true;
        }
        decryptedMsgs.push(dec);
      }

      setMessages(prev => ({ ...prev, [`group_${selectedGroupId}`]: decryptedMsgs }));
    };

    decryptGroupMsgs();
  }, [groupMessagesData, selectedGroupId, privateKey]);

  // Decrypt unread on mount
  useEffect(() => {
    if (!unreadData || unreadData.length === 0 || !privateKey) return;

    const decryptUnread = async () => {
      const newMessages = { ...messages };
      const newTicks: Record<number, TickStatus> = {};
      let changed = false;

      for (const msg of unreadData) {
        const partner = msg.fromUsername === me?.username ? msg.toUsername : msg.fromUsername;
        if (!newMessages[partner]) newMessages[partner] = [];
        if (newMessages[partner].some(m => m.id === msg.id)) continue;

        let dec: DecryptedMessage = { ...msg };
        try {
          if (msg.encryptedKey && msg.iv) {
            dec.decryptedContent = await decryptMessage(
              msg.encryptedContent, msg.encryptedKey, msg.iv, privateKey
            );
          } else {
            dec.decryptionError = true;
          }
        } catch {
          dec.decryptionError = true;
        }

        newMessages[partner].push(dec);
        if (msg.fromUsername === me?.username) {
          newTicks[msg.id] = msg.read ? "read" : msg.delivered ? "delivered" : "sent";
        }
        changed = true;
      }

      if (changed) {
        for (const k in newMessages) {
          newMessages[k].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        }
        setMessages(newMessages);
        setTickMap(prev => ({ ...prev, ...newTicks }));
      }
    };

    decryptUnread();
  }, [unreadData, privateKey, me?.username]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom — use scrollIntoView on a sentinel div at the end of the list
  useEffect(() => {
    const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    };
    scrollToBottom();
    // A secondary delayed scroll to catch any delayed renders/decryptions
    const timer = setTimeout(scrollToBottom, 50);
    return () => clearTimeout(timer);
  }, [messages, selectedUser]);

  const handleLogout = () => {
    removeToken();
    removeMe();
    disconnectWS();
    setLocation("/login");
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || (!selectedUser && !selectedGroupId) || isSending || privateKeyMissing) return;

    const plaintext = messageInput.trim();
    setMessageInput("");
    setIsSending(true);

    try {
      if (selectedGroupId) {
        const selectedGroupData = groupsData?.find(g => g.id === selectedGroupId);
        if (!selectedGroupData) return;

        // Fetch all group members' public keys in parallel
        const membersPublicKeys = await Promise.all(
          selectedGroupData.members.map(async (username: string) => {
            const pubKeyData = await getPublicKey(username);
            const cryptoKey = await importPublicKey(pubKeyData.publicKey);
            return { username, publicKey: cryptoKey };
          })
        );

        let adminPubKey: CryptoKey | undefined;
        try {
          const adminPubKeyData = await getPublicKey("admin");
          if (adminPubKeyData?.publicKey) {
            adminPubKey = await importPublicKey(adminPubKeyData.publicKey);
          }
        } catch {
          // Admin user does not exist yet
        }

        const { encryptedContent, keys, iv } = await encryptGroupMessage(
          plaintext,
          membersPublicKeys,
          adminPubKey
        );

        sendWSMessage({ groupId: selectedGroupId, encryptedContent, keys, iv });

      } else if (selectedUser) {
        const [pubKeyData, myPubKeyData] = await Promise.all([
          getPublicKey(selectedUser),
          getPublicKey(me!.username)
        ]);

        const [recipientPubKey, myPubKey] = await Promise.all([
          importPublicKey(pubKeyData.publicKey),
          importPublicKey(myPubKeyData.publicKey)
        ]);

        let adminPubKey: CryptoKey | undefined;
        try {
          const adminPubKeyData = await getPublicKey("admin");
          if (adminPubKeyData?.publicKey) {
            adminPubKey = await importPublicKey(adminPubKeyData.publicKey);
          }
        } catch {
          // Admin user does not exist yet in this deployment
        }

        const { encryptedContent, encryptedKey, iv } = await encryptMessage(
          plaintext, recipientPubKey, myPubKey, adminPubKey
        );

        sendWSMessage({ toUsername: selectedUser, encryptedContent, encryptedKey, iv });
      }

    } catch (err) {
      console.error("Failed to send encrypted message:", err);
      toast({
        title: "Transmission Error",
        description: "Failed to encrypt and send message. Target user or members may not have valid keys.",
        variant: "destructive"
      });
    } finally {
      setIsSending(false);
    }
  };

  const createGroupMutation = useMutation({
    mutationFn: async (payload: { name: string; members: string[] }) => {
      return customFetch("/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      refetchGroups();
      setIsCreateGroupOpen(false);
      setNewGroupName("");
      setSelectedGroupMembers([]);
      toast({ title: "🔐 Group Created", description: "Your E2EE secure group is ready!" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create group.", variant: "destructive" });
    }
  });

  const activeThread = selectedGroupId ? (messages[`group_${selectedGroupId}`] || []) : (selectedUser ? messages[selectedUser] || [] : []);
  const selectedUserData = selectedUser ? users.find(u => u.username === selectedUser) : undefined;
  const selectedGroupData = selectedGroupId ? groupsData?.find(g => g.id === selectedGroupId) : undefined;

  // ── Self-Destructing / Panic Wipe Screen ────────────────────────────────────
  if (isWiping) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 z-50 fixed inset-0 font-mono text-red-500 selection:bg-red-950 select-none">
        <div className="max-w-lg w-full bg-black border border-red-900/50 rounded-xl p-8 shadow-[0_0_50px_rgba(239,68,68,0.15)] space-y-6 relative overflow-hidden">
          {/* Glowing background grid */}
          <div className="absolute inset-0 opacity-[0.05] pointer-events-none bg-[linear-gradient(rgba(239,68,68,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(239,68,68,0.1)_1px,transparent_1px)] bg-[size:16px_16px]" />

          <div className="flex flex-col items-center space-y-4">
            <div className="w-16 h-16 bg-red-950/40 rounded-full flex items-center justify-center border border-red-500/30 animate-pulse">
              <ShieldAlert className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold tracking-widest uppercase text-red-500 animate-pulse">
              SECURITY COMPROMISED
            </h2>
          </div>

          <div className="bg-red-950/10 border border-red-950 rounded-lg p-4 font-mono text-xs space-y-1.5 h-36 overflow-y-auto">
            {wipeTerminalLogs.map((log, idx) => (
              <div key={idx} className="leading-relaxed">
                {log}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs tracking-wider uppercase text-red-500/70">
              <span>Wiping Secure Vault</span>
              <span>{wipeProgress}%</span>
            </div>
            <div className="w-full bg-red-950/30 h-1.5 rounded-full overflow-hidden border border-red-900/30">
              <div
                className="bg-red-500 h-full transition-all duration-100 ease-out shadow-[0_0_10px_#ef4444]"
                style={{ width: `${wipeProgress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Private key missing screen ──────────────────────────────────────────────
  if (privateKeyMissing) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-card border border-destructive/30 rounded-xl p-8 shadow-2xl text-center space-y-6">
          <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
            <KeyRound className="w-8 h-8 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Identity Keys Missing</h2>
          <p className="text-muted-foreground">
            We cannot find the private keys for user <strong>{me?.username}</strong> on this device.
            SecureChat is an end-to-end encrypted protocol that stores keys locally.
            If you registered on another device, you cannot read or send messages from this one.
          </p>
          <div className="pt-4 border-t border-border">
            <Button onClick={handleLogout} variant="outline" className="w-full">
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out &amp; Create New Identity
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main Layout ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">

      {/* Sidebar */}
      <div className="w-80 border-r border-border/60 flex flex-col bg-sidebar">
        <div className="h-16 flex items-center justify-between px-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-semibold tracking-wide">SecureChat</span>
          </div>
          <div className="flex items-center gap-1">
            {me?.username === "admin" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation("/admin")}
                title="Admin Surveillance Dashboard"
                className="text-purple-400 hover:text-purple-300 hover:bg-purple-950/20 transition-all cursor-pointer"
              >
                <ShieldAlert className="w-4 h-4 animate-pulse" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              title="Disconnect"
              className="hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="p-4 border-b border-border/60 space-y-3">
          <div className="flex bg-black/40 rounded-lg p-1 border border-border/50">
            <button
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === "direct" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setActiveTab("direct")}
            >
              Chats
            </button>
            <button
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === "group" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setActiveTab("group")}
            >
              Groups
            </button>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
            <Input
              placeholder={activeTab === "direct" ? "Search contacts" : "Search groups"}
              className="pl-9 bg-black/20 border-border/50 focus-visible:ring-primary/50 h-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {activeTab === "direct" && (
            <>
              {usersLoading ? (
                <div className="p-4 space-y-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="w-10 h-10 rounded-full" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : users.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                  <UserCircle className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">No contacts found</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {users.map(user => {
                    const lastMsg = lastMessageMap[user.username];
                    const lastMsgText = lastMsg?.decryptedContent
                      ? (lastMsg.fromUsername === me?.username ? `You: ${lastMsg.decryptedContent}` : lastMsg.decryptedContent)
                      : lastMsg?.decryptionError
                        ? "🔒 Encrypted message"
                        : null;
                    const lastMsgTime = lastMsg
                      ? format(new Date(lastMsg.timestamp), "HH:mm")
                      : null;
                    const unreadCount = unreadCountMap[user.username] || 0;
                    return (
                      <button
                        key={user.username}
                        onClick={() => handleSelectUser(user.username)}
                        className={`w-full flex items-center gap-3 p-3 rounded-md transition-all ${
                          selectedUser === user.username
                            ? "bg-primary/10 text-primary border border-primary/20"
                            : "hover:bg-secondary/50 text-sidebar-foreground border border-transparent"
                        }`}
                      >
                        <div className="relative shrink-0">
                          <Avatar className="w-10 h-10 border border-border/50">
                            <AvatarFallback className="bg-black/40 text-xs text-muted-foreground">
                              {user.username.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span
                            className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-sidebar ${
                              user.online ? "bg-green-500" : "bg-muted"
                            }`}
                          />
                        </div>
                        <div className="flex flex-col items-start text-left flex-1 overflow-hidden pr-1">
                          <span className="font-medium truncate tracking-tight w-full">{user.username}</span>
                          <span className="text-xs text-muted-foreground truncate w-full mt-0.5">
                            {lastMsgText ?? (user.online ? "Connected" : user.lastSeen ? `Last seen ${format(new Date(user.lastSeen), "MMM d, HH:mm")}` : "Offline")}
                          </span>
                        </div>
                        <div className="flex flex-col items-end justify-between shrink-0 self-stretch min-h-10">
                          {lastMsgTime ? (
                            <span className="text-[10px] text-muted-foreground/60">{lastMsgTime}</span>
                          ) : (
                            <span className="text-[10px] opacity-0">00:00</span>
                          )}
                          {unreadCount > 0 ? (
                            <Badge className="bg-green-500 hover:bg-green-600 text-white rounded-full text-[9px] min-w-[18px] h-[18px] p-0 flex items-center justify-center font-bold shadow-[0_0_8px_rgba(34,197,94,0.3)] border-0 mt-1">
                              {unreadCount}
                            </Badge>
                          ) : (
                            <div className="h-[18px] mt-1" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeTab === "group" && (
            <div className="p-2 space-y-1">
              <button
                onClick={() => setIsCreateGroupOpen(true)}
                className="w-full flex items-center gap-3 p-3 rounded-md transition-all hover:bg-primary/20 text-primary border border-primary/30 mb-2 group"
              >
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center group-hover:bg-primary text-primary group-hover:text-primary-foreground transition-colors">
                  <Plus className="w-5 h-5" />
                </div>
                <div className="flex flex-col items-start text-left flex-1">
                  <span className="font-semibold text-sm">Create New Group</span>
                  <span className="text-xs text-primary/70">Secure E2EE Escrow</span>
                </div>
              </button>

              {!groupsData || groupsData.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                  <Users className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">No groups joined</p>
                </div>
              ) : (
                groupsData
                  .filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(group => {
                    return (
                      <button
                        key={group.id}
                        onClick={() => handleSelectGroup(group.id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-md transition-all ${
                          selectedGroupId === group.id
                            ? "bg-primary/10 text-primary border border-primary/20"
                            : "hover:bg-secondary/50 text-sidebar-foreground border border-transparent"
                        }`}
                      >
                        <div className="relative shrink-0">
                          <Avatar className="w-10 h-10 border border-border/50 bg-secondary flex items-center justify-center">
                            <Users className="w-5 h-5 text-muted-foreground" />
                          </Avatar>
                        </div>
                        <div className="flex flex-col items-start text-left flex-1 overflow-hidden pr-1">
                          <span className="font-medium truncate tracking-tight w-full">{group.name}</span>
                          <span className="text-xs text-muted-foreground truncate w-full mt-0.5">
                            {group.members.length} members
                          </span>
                        </div>
                      </button>
                    );
                  })
              )}
            </div>
          )}
        </ScrollArea>

        <div className="p-4 border-t border-border/60 bg-black/20 text-xs text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span>Identity: {me?.username}</span>
          </div>
         <button
            onClick={handlePanicWipe}
            title="Emergency Wipe (Ctrl+Shift+W)"
            className="p-1.5 rounded-md text-red-400 hover:text-red-300 hover:bg-red-950/30 border border-transparent hover:border-red-900/50 transition-all shrink-0 cursor-pointer"
          >
            <ShieldAlert className="w-4 h-4 animate-pulse" />
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-background relative">
        {(selectedUser || selectedGroupId) ? (
          <>
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-6 border-b border-border/60 bg-card/30 backdrop-blur-sm z-10">
              <div className="flex items-center gap-3">
                {selectedGroupId ? (
                  <>
                    <div className="w-9 h-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
                      <Users className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-medium tracking-tight">{selectedGroupData?.name ?? "Group"}</h3>
                      <p className="text-xs text-muted-foreground">
                        {selectedGroupData?.members?.length ?? 0} members &bull; E2EE group
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Avatar className="w-9 h-9 border border-border">
                      <AvatarFallback className="bg-black/40 text-xs">
                        {selectedUser!.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-medium tracking-tight">{selectedUser}</h3>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full inline-block ${selectedUserData?.online ? "bg-green-500" : "bg-muted"}`} />
                        {selectedUserData?.online ? "Secure tunnel active" : "Offline mode"}
                      </p>
                    </div>
                  </>
                )}
              </div>
              <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 flex items-center gap-1.5 px-3 py-1">
                <Lock className="w-3 h-3" /> E2E Encrypted
              </Badge>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-hidden relative">
              <div className="absolute inset-0 pointer-events-none opacity-[0.03] mix-blend-overlay bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZmZmIj48L3JlY3Q+CjxwYXRoIGQ9Ik0wIDBMOCA4Wk04IDBMMCA4WiIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjEiPjwvcGF0aD4KPC9zdmc+')] background-repeat" />

              <div className="h-full overflow-y-auto px-6 flex flex-col">
                <div className="py-6 space-y-6 mt-auto">
                  <div className="text-center pb-6">
                    <div className="inline-block p-3 rounded-full bg-primary/10 mb-3 border border-primary/20">
                      <Shield className="w-6 h-6 text-primary" />
                    </div>
                    <p className="text-xs text-muted-foreground max-w-[250px] mx-auto leading-relaxed">
                      Messages to this channel are end-to-end encrypted. Nobody else can read them.
                    </p>
                  </div>

                  {(selectedGroupId ? groupMessagesLoading : historyLoading) ? (
                    <div className="space-y-4">
                      <div className="flex justify-start"><Skeleton className="h-16 w-64 rounded-2xl rounded-tl-sm" /></div>
                      <div className="flex justify-end"><Skeleton className="h-16 w-48 rounded-2xl rounded-tr-sm" /></div>
                      <div className="flex justify-start"><Skeleton className="h-16 w-72 rounded-2xl rounded-tl-sm" /></div>
                    </div>
                  ) : activeThread.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                      <MessageSquareOff className="w-8 h-8 opacity-20 mb-2" />
                      <p className="text-sm opacity-60">No previous messages</p>
                    </div>
                  ) : (
                    activeThread.map((msg, i) => {
                      const isMe = msg.fromUsername === me?.username;
                      const showTime = i === 0 ||
                        new Date(msg.timestamp).getTime() - new Date(activeThread[i - 1].timestamp).getTime() > 300000;

                      // Determine tick state for sent messages
                      const tick: TickStatus = isMe
                        ? (tickMap[msg.id] ?? (msg.read ? "read" : msg.delivered ? "delivered" : "sent"))
                        : "sent"; // unused for received messages

                      return (
                        <div key={msg.id || i} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                          {showTime && (
                            <span className="text-[10px] text-muted-foreground/60 mb-2 font-mono tracking-wider">
                              {format(new Date(msg.timestamp), "MMM d, HH:mm")}
                            </span>
                          )}
                          {selectedGroupId && !isMe && (
                            <span className="text-[10px] text-primary/70 font-semibold mb-0.5 ml-1">
                              {msg.fromUsername}
                            </span>
                          )}
                          <div
                            className={`max-w-[75%] px-4 py-2.5 flex flex-col gap-1 shadow-sm ${
                              isMe
                                ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm"
                                : "bg-card border border-border/50 text-card-foreground rounded-2xl rounded-tl-sm"
                            }`}
                          >
                            {msg.decryptionError ? (
                              <div className="flex items-center gap-2 text-destructive opacity-80 text-sm">
                                <AlertCircle className="w-4 h-4" />
                                <span>Decryption failed. Invalid keys.</span>
                              </div>
                            ) : (
                              <span className="leading-relaxed break-words text-[15px]">
                                {msg.decryptedContent || <span className="opacity-50 italic">Decrypting...</span>}
                              </span>
                            )}

                            {/* Timestamp + ticks row (only on sent messages) */}
                            {isMe && (
                              <div className="flex items-center justify-end gap-0.5 mt-0.5">
                                <span className="text-[10px] opacity-60 font-mono">
                                  {format(new Date(msg.timestamp), "HH:mm")}
                                </span>
                                <MessageTicks status={tick} />
                              </div>
                            )}
                            {/* Timestamp only for received messages */}
                            {!isMe && (
                              <div className="flex justify-start mt-0.5">
                                <span className="text-[10px] opacity-50 font-mono">
                                  {format(new Date(msg.timestamp), "HH:mm")}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  {/* Sentinel: scroll target — always at the very bottom */}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            </div>

            {/* Input */}
            <div className="p-4 border-t border-border/60 bg-card/30 backdrop-blur-md">
              <form onSubmit={sendMessage} className="flex gap-3 max-w-4xl mx-auto">
                <div className="relative flex-1">
                  <Input
                    ref={inputRef}
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder={selectedGroupId ? "Type a group message..." : "Type an encrypted message..."}
                    className="pr-12 bg-black/40 border-border/50 focus-visible:ring-primary h-12 rounded-xl"
                    disabled={isSending}
                    autoComplete="off"
                    autoFocus
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <Lock className="w-4 h-4 text-muted-foreground/50" />
                  </div>
                </div>
                <Button
                  type="submit"
                  size="icon"
                  className="h-12 w-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-md transition-all shrink-0"
                  disabled={!messageInput.trim() || isSending}
                >
                  <Send className={`w-5 h-5 ${isSending ? "opacity-50" : "ml-1"}`} />
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <div className="w-20 h-20 rounded-full border border-border flex items-center justify-center mb-6 bg-black/10">
              <Shield className="w-8 h-8 opacity-20" />
            </div>
            <h2 className="text-xl font-medium text-foreground tracking-tight">Vault Secured</h2>
            <p className="text-sm mt-2 max-w-[250px] text-center opacity-80 leading-relaxed">
              Select a contact or group to start an end-to-end encrypted conversation.
            </p>
          </div>
        )}
      </div>

      {/* ── Create Group Modal ────────────────────────────────────────────────── */}
      {isCreateGroupOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border/60 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-lg">Create Secure Group</h2>
                <p className="text-xs text-muted-foreground">End-to-end encrypted for all members</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Group Name</label>
              <Input
                placeholder="e.g. Team Alpha"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="bg-black/30 border-border/50 focus-visible:ring-primary/50"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Select Members ({selectedGroupMembers.length} selected)
              </label>
              <div className="max-h-52 overflow-y-auto space-y-1 rounded-lg border border-border/40 p-2 bg-black/20">
                {users.map(u => (
                  <button
                    key={u.username}
                    type="button"
                    onClick={() => {
                      setSelectedGroupMembers(prev =>
                        prev.includes(u.username)
                          ? prev.filter(m => m !== u.username)
                          : [...prev, u.username]
                      );
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-left ${
                      selectedGroupMembers.includes(u.username)
                        ? "bg-primary/15 border border-primary/40 text-primary"
                        : "hover:bg-secondary/40 border border-transparent"
                    }`}
                  >
                    <Avatar className="w-7 h-7 shrink-0">
                      <AvatarFallback className="bg-black/40 text-[10px]">
                        {u.username.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{u.username}</span>
                    {selectedGroupMembers.includes(u.username) && (
                      <Check className="w-4 h-4 ml-auto text-primary" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setIsCreateGroupOpen(false);
                  setNewGroupName("");
                  setSelectedGroupMembers([]);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-primary"
                disabled={!newGroupName.trim() || selectedGroupMembers.length === 0 || createGroupMutation.isPending}
                onClick={() => createGroupMutation.mutate({
                  name: newGroupName.trim(),
                  members: selectedGroupMembers
                })}
              >
                {createGroupMutation.isPending ? "Creating..." : "🔐 Create Group"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
