import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { 
  Shield, 
  User, 
  MessageSquare, 
  Lock, 
  Search, 
  LogOut, 
  KeyRound, 
  ShieldAlert,
  ArrowRight,
  RefreshCw
} from "lucide-react";

import { useListUsers, type Message as ApiMessage } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

import { getToken, getMe, removeToken, removeMe } from "@/lib/auth";
import { loadPrivateKey, decryptMessage } from "@/lib/crypto";
import { customFetch } from "@workspace/api-client-react";

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const me = getMe();
  const token = getToken();

  // Redirect non-admins
  useEffect(() => {
    if (!token) {
      setLocation("/login");
      return;
    }
    if (me?.username !== "admin") {
      toast({
        title: "Unauthorized Access",
        description: "Only the master 'admin' account can view the Admin Surveillance Panel.",
        variant: "destructive"
      });
      setLocation("/");
    }
  }, [me, token, setLocation, toast]);

  const { data: users = [], isLoading: usersLoading } = useListUsers();

  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [privateKeyMissing, setPrivateKeyMissing] = useState(false);
  const [rawMessages, setRawMessages] = useState<ApiMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [selectedThreadPartner, setSelectedThreadPartner] = useState<string | null>(null);
  const [decryptedMessages, setDecryptedMessages] = useState<Record<number, string>>({});
  const [searchTerm, setSearchTerm] = useState("");

  // Load Admin Private Key on mount
  useEffect(() => {
    if (!me || me.username !== "admin") return;
    loadPrivateKey("admin")
      .then(key => {
        if (key) {
          setPrivateKey(key);
        } else {
          setPrivateKeyMissing(true);
        }
      })
      .catch(() => setPrivateKeyMissing(true));
  }, [me]);

  // Fetch all messages in the system
  const fetchAllMessages = useCallback(async () => {
    if (me?.username !== "admin") return;
    setMessagesLoading(true);
    try {
      const data = await customFetch<ApiMessage[]>("/api/admin/messages");
      setRawMessages(data);
    } catch (err) {
      const errMsg = err && typeof err === "object" && "data" in err && err.data && typeof err.data === "object" && "error" in err.data
        ? String(err.data.error)
        : (err && typeof err === "object" && "data" in err && err.data && typeof err.data === "object" && "detail" in err.data
            ? String(err.data.detail)
            : "Failed to fetch secure master logs from backend.");
      toast({
        title: "Database Error",
        description: errMsg,
        variant: "destructive"
      });
    } finally {
      setMessagesLoading(false);
    }
  }, [me, toast]);

  useEffect(() => {
    fetchAllMessages();
  }, [fetchAllMessages]);

  // Filter users based on search term (exclude admin itself)
  const filteredUsers = useMemo(() => {
    return users
      .filter(u => u.username !== "admin")
      .filter(u => u.username.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [users, searchTerm]);

  // Find all conversation partners for the selected user
  const userThreads = useMemo(() => {
    if (!selectedUser) return [];
    const partners = new Set<string>();
    for (const msg of rawMessages) {
      if (msg.fromUsername === selectedUser && msg.toUsername) {
        partners.add(msg.toUsername);
      } else if (msg.toUsername === selectedUser && msg.fromUsername) {
        partners.add(msg.fromUsername);
      }
    }
    // Remove admin from the thread partners list
    partners.delete("admin");
    return Array.from(partners);
  }, [selectedUser, rawMessages]);

  // Filter messages for the active conversation Alice <-> Bob
  const activeConversation = useMemo(() => {
    if (!selectedUser || !selectedThreadPartner) return [];
    return rawMessages.filter(
      msg =>
        (msg.fromUsername === selectedUser && msg.toUsername === selectedThreadPartner) ||
        (msg.fromUsername === selectedThreadPartner && msg.toUsername === selectedUser)
    );
  }, [selectedUser, selectedThreadPartner, rawMessages]);

  const decryptedRef = useRef<Record<number, string>>({});

  // Decrypt conversation messages when they change
  useEffect(() => {
    if (!privateKey || activeConversation.length === 0) return;

    let active = true;

    const decryptAll = async () => {
      const newDecrypted: Record<number, string> = {};
      let changed = false;

      for (const msg of activeConversation) {
        if (!active) return;
        if (decryptedRef.current[msg.id] !== undefined) continue;

        try {
          if (msg.encryptedKey && msg.iv) {
            const decText = await decryptMessage(
              msg.encryptedContent,
              msg.encryptedKey,
              msg.iv,
              privateKey
            );
            newDecrypted[msg.id] = decText;
            decryptedRef.current[msg.id] = decText;
          } else {
            newDecrypted[msg.id] = "[ERROR: Missing Decryption Key]";
            decryptedRef.current[msg.id] = "[ERROR: Missing Decryption Key]";
          }
        } catch {
          newDecrypted[msg.id] = "[DECRYPTION FAILED: Message not escrowed for Admin]";
          decryptedRef.current[msg.id] = "[DECRYPTION FAILED: Message not escrowed for Admin]";
        }
        changed = true;
      }

      if (active && changed) {
        setDecryptedMessages(prev => ({ ...prev, ...newDecrypted }));
      }
    };

    decryptAll();

    return () => {
      active = false;
    };
  }, [activeConversation, privateKey]);

  const handleLogout = () => {
    removeToken();
    removeMe();
    setLocation("/login");
  };

  if (me?.username !== "admin") return null;

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans selection:bg-purple-950 selection:text-purple-200">
      {/* Admin Title Banner */}
      <header className="h-16 border-b border-purple-900/50 bg-black/60 backdrop-blur-md px-6 flex items-center justify-between z-10 shadow-[0_4px_30px_rgba(120,53,190,0.15)]">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-950/40 rounded-lg border border-purple-500/40 animate-pulse">
            <Shield className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-widest text-purple-300 uppercase">
              Surveillance Dashboard
            </h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
              End-to-End Master Decryption Console
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchAllMessages}
            disabled={messagesLoading}
            className="text-purple-400 hover:text-purple-300 hover:bg-purple-950/20"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${messagesLoading ? "animate-spin" : ""}`} />
            Refresh Logs
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/")}
            className="text-muted-foreground hover:text-foreground"
          >
            Back to Chat
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-red-400 hover:text-red-300 hover:bg-red-950/20"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </header>

      {/* Main Panel layout */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* PANEL 1: Users Directory */}
        <div className="w-80 border-r border-purple-900/30 bg-black/40 flex flex-col shrink-0">
          <div className="p-4 border-b border-purple-900/20">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search usernames..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-black/40 border border-purple-900/30 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500/50 text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              <div className="px-3 py-2 text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                Registered Users
              </div>
              
              {usersLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3">
                    <Skeleton className="w-9 h-9 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))
              ) : filteredUsers.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No registered users found
                </div>
              ) : (
                filteredUsers.map(user => {
                  const isSelected = selectedUser === user.username;
                  return (
                    <button
                      key={user.username}
                      onClick={() => {
                        setSelectedUser(user.username);
                        setSelectedThreadPartner(null);
                      }}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all ${
                        isSelected
                          ? "bg-purple-950/30 border border-purple-900/50 text-purple-200"
                          : "hover:bg-purple-950/10 border border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Avatar className="w-9 h-9 border border-purple-950/40">
                        {user.profilePicture ? (
                          <AvatarImage src={user.profilePicture} className="object-cover w-full h-full" />
                        ) : null}
                        <AvatarFallback className="bg-purple-950/40 text-purple-300 text-xs">
                          {user.username.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm truncate">{user.username}</span>
                          {user.online ? (
                            <Badge className="bg-purple-500/20 text-purple-400 border border-purple-500/30 text-[9px] px-1 py-0 hover:bg-purple-500/20">
                              Active
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Offline</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        {/* PANEL 2: Conversation Threads Directory */}
        <div className="w-80 border-r border-purple-900/20 bg-black/20 flex flex-col shrink-0">
          <div className="p-4 border-b border-purple-900/20 flex items-center justify-between">
            <h2 className="text-xs uppercase font-bold tracking-widest text-muted-foreground">
              Conversation Threads
            </h2>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {!selectedUser ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Select a user to view their conversation history.
                </div>
              ) : userThreads.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No active chats logged for {selectedUser}
                </div>
              ) : (
                userThreads.map(partner => {
                  const isSelected = selectedThreadPartner === partner;
                  return (
                    <button
                      key={partner}
                      onClick={() => setSelectedThreadPartner(partner)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all ${
                        isSelected
                          ? "bg-purple-950/45 border border-purple-900/50 text-purple-200 shadow-[0_0_15px_rgba(168,85,247,0.05)]"
                          : "hover:bg-purple-950/10 border border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <MessageSquare className="w-4 h-4 text-purple-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-semibold text-purple-300">{selectedUser}</span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <span className="font-medium text-foreground truncate">{partner}</span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        {/* PANEL 3: Decrypted Message Transcript Window */}
        <div className="flex-1 flex flex-col bg-black/10 relative">
          
          {/* Key Missing Banner warning */}
          {privateKeyMissing && (
            <div className="absolute inset-x-0 top-0 bg-red-950/40 border-b border-red-900/50 backdrop-blur-sm p-3 flex items-center gap-3 text-red-400 text-xs z-20">
              <ShieldAlert className="w-4 h-4 shrink-0 animate-pulse" />
              <span>
                <strong>Master Private Key Missing!</strong> The E2E keys for <strong>admin</strong> must be present in this browser to decrypt secure chats. Sign in as <strong>admin</strong> on this machine to build your secure key cache.
              </span>
            </div>
          )}

          {!selectedUser || !selectedThreadPartner ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
              <div className="w-16 h-16 bg-purple-950/20 rounded-full flex items-center justify-center border border-purple-500/10">
                <Lock className="w-8 h-8 text-purple-500/40 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-purple-300">Surveillance Channel Inactive</h3>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Select a registered user and an active conversation thread to initiate E2E message decryption and monitoring.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Active Header */}
              <div className="h-16 border-b border-purple-900/20 px-6 flex items-center justify-between bg-black/20">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-purple-500/40 text-purple-400 uppercase tracking-widest text-[9px] font-mono px-2 py-0.5 animate-pulse bg-purple-950/20">
                    Decrypting Channel
                  </Badge>
                  <div className="text-xs font-mono font-medium">
                    <span className="text-purple-300 font-semibold">{selectedUser}</span>
                    <span className="mx-2 text-muted-foreground">↔</span>
                    <span className="text-foreground">{selectedThreadPartner}</span>
                  </div>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  Logged Transcripts: {activeConversation.length}
                </div>
              </div>

              {/* Chat log Scroll Area */}
              <ScrollArea className="flex-1 p-6">
                <div className="space-y-4 max-w-3xl mx-auto">
                  {activeConversation.map(msg => {
                    const isFromSelected = msg.fromUsername === selectedUser;
                    const text = decryptedMessages[msg.id];
                    const isError = text?.startsWith("[DECRYPTION FAILED") || text?.startsWith("[ERROR");

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isFromSelected ? "items-start" : "items-end"}`}
                      >
                        {/* Speaker info */}
                        <span className="text-[10px] font-mono text-muted-foreground mb-1 px-1">
                          {msg.fromUsername} • {format(new Date(msg.timestamp), "HH:mm:ss (MMM d)")}
                        </span>

                        {/* Bubble */}
                        <div
                          className={`max-w-lg rounded-xl p-3.5 text-sm border font-mono ${
                            isFromSelected
                              ? "bg-purple-950/15 border-purple-900/40 text-purple-200 rounded-tl-none shadow-[0_2px_10px_rgba(168,85,247,0.02)]"
                              : "bg-zinc-950/60 border-zinc-800 text-zinc-300 rounded-tr-none"
                          } ${isError ? "bg-red-950/10 border-red-900/30 text-red-400" : ""}`}
                        >
                          {text === undefined ? (
                            <div className="flex items-center gap-2 text-muted-foreground text-xs">
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Decrypting cipher block...</span>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap leading-relaxed break-words">
                              {text}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </>
          )}

        </div>

      </div>
    </div>
  );
}
