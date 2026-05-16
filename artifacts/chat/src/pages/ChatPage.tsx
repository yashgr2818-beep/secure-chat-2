import { useEffect, useState, useRef, useMemo } from "react";
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
  UserCircle
} from "lucide-react";

import { 
  useListUsers, 
  useGetMessages, 
  useGetUnreadMessages, 
  useGetPublicKey,
  getPublicKey
} from "@workspace/api-client-react";
import type { Message as ApiMessage } from "@workspace/api-client-react/src/generated/api.schemas";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

import { getToken, getMe, removeToken, removeMe } from "@/lib/auth";
import { 
  connectWS, 
  disconnectWS, 
  onMessage, 
  onStatusChange, 
  sendWSMessage 
} from "@/lib/websocket";
import { 
  loadPrivateKey, 
  decryptMessage, 
  importPublicKey, 
  encryptMessage 
} from "@/lib/crypto";

// Extend the API Message type with local decrypted content
type DecryptedMessage = ApiMessage & {
  decryptedContent?: string;
  decryptionError?: boolean;
};

export default function ChatPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const me = getMe();

  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, DecryptedMessage[]>>({});
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Real-time status map overrides
  const [liveStatuses, setLiveStatuses] = useState<Record<string, boolean>>({});
  const [isSending, setIsSending] = useState(false);
  const [privateKeyMissing, setPrivateKeyMissing] = useState(false);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  // 1. Initial auth & websocket setup
  useEffect(() => {
    const token = getToken();
    if (!token || !me) {
      setLocation("/login");
      return;
    }
    
    // Load private key
    loadPrivateKey(me.username).then(key => {
      if (!key) {
        setPrivateKeyMissing(true);
      } else {
        setPrivateKey(key);
      }
    }).catch(err => {
      console.error("Failed to load private key:", err);
      setPrivateKeyMissing(true);
    });

    connectWS(token);
    
    const unsubs = [
      onStatusChange((username, online) => {
        setLiveStatuses(prev => ({ ...prev, [username]: online }));
      }),
      onMessage(async (msg: ApiMessage) => {
        if (!me) return;
        
        // Determine conversation partner (could be us if it's a message_sent echo)
        const partner = msg.fromUsername === me.username ? msg.toUsername : msg.fromUsername;
        
        let decrypted: DecryptedMessage = { ...msg };
        
        // Decrypt if we have the private key
        try {
          const keyToUse = await loadPrivateKey(me.username);
          if (keyToUse && msg.encryptedKey && msg.iv) {
            const content = await decryptMessage(msg.encryptedContent, msg.encryptedKey, msg.iv, keyToUse);
            decrypted.decryptedContent = content;
          } else {
            decrypted.decryptionError = true;
          }
        } catch (e) {
          decrypted.decryptionError = true;
          console.error("Decryption failed for incoming WS message:", e);
        }
        
        setMessages(prev => {
          const thread = prev[partner] || [];
          // Avoid duplicates
          if (thread.some(m => m.id === msg.id)) return prev;
          
          return {
            ...prev,
            [partner]: [...thread, decrypted].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
          };
        });
      })
    ];

    return () => {
      unsubs.forEach(fn => fn());
      disconnectWS();
    };
  }, [setLocation, me?.username]);

  // Queries
  const { data: usersData, isLoading: usersLoading } = useListUsers();
  
  // Combine server status with real-time status
  const users = useMemo(() => {
    if (!usersData) return [];
    return usersData
      .filter(u => u.username !== me?.username)
      .map(u => ({
        ...u,
        online: liveStatuses[u.username] !== undefined ? liveStatuses[u.username] : u.online
      }))
      .filter(u => u.username.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [usersData, liveStatuses, searchQuery, me?.username]);

  const { data: historyData, isLoading: historyLoading } = useGetMessages(selectedUser || "", {
    query: {
      enabled: !!selectedUser && !privateKeyMissing && !!privateKey,
    }
  });

  const { data: unreadData } = useGetUnreadMessages({
    query: {
      enabled: !privateKeyMissing && !!privateKey,
    }
  });

  // Decrypt history when loaded
  useEffect(() => {
    if (!selectedUser || !historyData || !privateKey) return;
    
    const decryptHistory = async () => {
      const decryptedMsgs: DecryptedMessage[] = [];
      for (const msg of historyData) {
        let dec: DecryptedMessage = { ...msg };
        try {
          if (msg.encryptedKey && msg.iv) {
            dec.decryptedContent = await decryptMessage(msg.encryptedContent, msg.encryptedKey, msg.iv, privateKey);
          } else {
            dec.decryptionError = true;
          }
        } catch (e) {
          dec.decryptionError = true;
        }
        decryptedMsgs.push(dec);
      }
      
      setMessages(prev => ({
        ...prev,
        [selectedUser]: decryptedMsgs
      }));
    };
    
    decryptHistory();
  }, [historyData, selectedUser, privateKey]);

  // Decrypt unread on mount
  useEffect(() => {
    if (!unreadData || unreadData.length === 0 || !privateKey) return;
    
    const decryptUnread = async () => {
      const newMessages = { ...messages };
      let changed = false;
      
      for (const msg of unreadData) {
        const partner = msg.fromUsername === me?.username ? msg.toUsername : msg.fromUsername;
        if (!newMessages[partner]) newMessages[partner] = [];
        
        // Skip if already have
        if (newMessages[partner].some(m => m.id === msg.id)) continue;
        
        let dec: DecryptedMessage = { ...msg };
        try {
          if (msg.encryptedKey && msg.iv) {
            dec.decryptedContent = await decryptMessage(msg.encryptedContent, msg.encryptedKey, msg.iv, privateKey);
          } else {
            dec.decryptionError = true;
          }
        } catch (e) {
          dec.decryptionError = true;
        }
        
        newMessages[partner].push(dec);
        changed = true;
      }
      
      if (changed) {
        // Sort threads
        for (const k in newMessages) {
          newMessages[k].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        }
        setMessages(newMessages);
      }
    };
    
    decryptUnread();
  }, [unreadData, privateKey, me?.username]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, selectedUser]);

  const handleLogout = () => {
    removeToken();
    removeMe();
    disconnectWS();
    setLocation("/login");
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedUser || isSending || privateKeyMissing) return;

    const plaintext = messageInput.trim();
    setMessageInput("");
    setIsSending(true);

    try {
      // 1. Fetch keys
      const [pubKeyData, myPubKeyData] = await Promise.all([
        getPublicKey(selectedUser),
        getPublicKey(me!.username)
      ]);
      
      // 2. Import them
      const [recipientPubKey, myPubKey] = await Promise.all([
        importPublicKey(pubKeyData.publicKey),
        importPublicKey(myPubKeyData.publicKey)
      ]);
      
      // 3. Encrypt message for both
      const { encryptedContent, encryptedKey, iv } = await encryptMessage(plaintext, recipientPubKey, myPubKey);
      
      // 4. Send via WS
      sendWSMessage({
        toUsername: selectedUser,
        encryptedContent,
        encryptedKey,
        iv
      });
      
    } catch (err) {
      console.error("Failed to send encrypted message:", err);
      toast({
        title: "Transmission Error",
        description: "Failed to encrypt and send message. Target user may not have valid keys.",
        variant: "destructive"
      });
    } finally {
      setIsSending(false);
    }
  };

  const activeThread = selectedUser ? messages[selectedUser] || [] : [];
  const selectedUserData = users.find(u => u.username === selectedUser);

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
              Sign Out & Create New Identity
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Sidebar */}
      <div className="w-80 border-r border-border/60 flex flex-col bg-sidebar">
        <div className="h-16 flex items-center justify-between px-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-semibold tracking-wide">SecureChat</span>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} title="Disconnect" className="hover:bg-destructive/10 hover:text-destructive transition-colors">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-4 border-b border-border/60">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
            <Input 
              placeholder="Search contacts" 
              className="pl-9 bg-black/20 border-border/50 focus-visible:ring-primary/50" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {usersLoading ? (
            <div className="p-4 space-y-4">
              {[1,2,3,4].map(i => (
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
              {users.map(user => (
                <button
                  key={user.username}
                  onClick={() => setSelectedUser(user.username)}
                  className={`w-full flex items-center gap-3 p-3 rounded-md transition-all ${
                    selectedUser === user.username 
                      ? "bg-primary/10 text-primary border border-primary/20" 
                      : "hover:bg-secondary/50 text-sidebar-foreground border border-transparent"
                  }`}
                >
                  <div className="relative">
                    <Avatar className="w-10 h-10 border border-border/50">
                      <AvatarFallback className="bg-black/40 text-xs text-muted-foreground">
                        {user.username.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-sidebar ${user.online ? "bg-green-500" : "bg-muted"}`} />
                  </div>
                  <div className="flex flex-col items-start text-left flex-1 overflow-hidden">
                    <span className="font-medium truncate w-full tracking-tight">{user.username}</span>
                    <span className="text-xs text-muted-foreground truncate w-full">
                      {user.online ? "Connected" : user.lastSeen ? `Last seen ${format(new Date(user.lastSeen), "MMM d, HH:mm")}` : "Offline"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
        
        <div className="p-4 border-t border-border/60 bg-black/20 text-xs text-muted-foreground flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          Identity: {me?.username}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-background relative">
        {selectedUser ? (
          <>
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-6 border-b border-border/60 bg-card/30 backdrop-blur-sm z-10">
              <div className="flex items-center gap-3">
                <Avatar className="w-9 h-9 border border-border">
                  <AvatarFallback className="bg-black/40 text-xs">
                    {selectedUser.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-medium tracking-tight">{selectedUser}</h3>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${selectedUserData?.online ? "bg-green-500" : "bg-muted"}`} />
                    {selectedUserData?.online ? "Secure tunnel active" : "Offline mode"}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 flex items-center gap-1.5 px-3 py-1">
                <Lock className="w-3 h-3" /> E2E Encrypted
              </Badge>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-hidden relative">
              <div className="absolute inset-0 pointer-events-none opacity-[0.03] mix-blend-overlay bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZmZmIj48L3JlY3Q+CjxwYXRoIGQ9Ik0wIDBMOCA4Wk04IDBMMCA4WiIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjEiPjwvcGF0aD4KPC9zdmc+')] background-repeat" />
              
              <ScrollArea className="h-full px-6" ref={scrollRef}>
                <div className="py-6 space-y-6">
                  <div className="text-center pb-6">
                    <div className="inline-block p-3 rounded-full bg-primary/10 mb-3 border border-primary/20">
                      <Shield className="w-6 h-6 text-primary" />
                    </div>
                    <p className="text-xs text-muted-foreground max-w-[250px] mx-auto leading-relaxed">
                      Messages to this channel are end-to-end encrypted. Nobody else can read them.
                    </p>
                  </div>
                  
                  {historyLoading ? (
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
                      const showTime = i === 0 || new Date(msg.timestamp).getTime() - new Date(activeThread[i-1].timestamp).getTime() > 300000;
                      
                      return (
                        <div key={msg.id || i} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                          {showTime && (
                            <span className="text-[10px] text-muted-foreground/60 mb-2 font-mono tracking-wider">
                              {format(new Date(msg.timestamp), "MMM d, HH:mm")}
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
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Input */}
            <div className="p-4 border-t border-border/60 bg-card/30 backdrop-blur-md">
              <form onSubmit={sendMessage} className="flex gap-3 max-w-4xl mx-auto">
                <div className="relative flex-1">
                  <Input 
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder="Type an encrypted message..." 
                    className="pr-12 bg-black/40 border-border/50 focus-visible:ring-primary h-12 rounded-xl"
                    disabled={isSending}
                    autoComplete="off"
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
              Select a contact to establish an end-to-end encrypted connection.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
