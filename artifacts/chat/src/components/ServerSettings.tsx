import { useState, useEffect } from "react";
import { Server, Settings2, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { setBaseUrl } from "@workspace/api-client-react";

export function ServerSettings() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      const saved = localStorage.getItem("securechat_api_url") || "";
      setUrl(saved);
      setStatus("idle");
    }
  }, [open]);

  const testConnection = async (testUrl: string) => {
    setStatus("testing");
    try {
      const targetUrl = testUrl || import.meta.env.VITE_API_URL || window.location.origin;
      const res = await fetch(`${targetUrl.replace(/\/$/, "")}/api/healthz`);
      if (res.ok) {
        setStatus("success");
        return true;
      }
      throw new Error("Invalid response");
    } catch (e) {
      setStatus("error");
      return false;
    }
  };

  const handleSave = async () => {
    const cleanUrl = url.trim().replace(/\/$/, "");
    if (cleanUrl) {
      const isOk = await testConnection(cleanUrl);
      if (!isOk) {
        toast({
          title: "Connection Failed",
          description: "Could not connect to the specified server.",
          variant: "destructive",
        });
        return;
      }
      localStorage.setItem("securechat_api_url", cleanUrl);
      setBaseUrl(cleanUrl);
      toast({
        title: "Server Configured",
        description: "API requests will now be routed to this server.",
      });
    } else {
      localStorage.removeItem("securechat_api_url");
      setBaseUrl(import.meta.env.VITE_API_URL || null);
      toast({
        title: "Server Reset",
        description: "Using default server configuration.",
      });
    }
    
    // Reload to re-initialize WebSockets and React Query if needed
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="absolute top-4 right-4 rounded-full bg-background/50 backdrop-blur-md border border-border/50 hover:bg-accent">
          <Settings2 className="h-5 w-5 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md border-border/50 bg-card/95 backdrop-blur-xl shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Server className="h-5 w-5 text-primary" />
            Server Configuration
          </DialogTitle>
          <DialogDescription>
            Override the backend API server URL. Useful when hosting the frontend separately from the backend.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/80">API Server URL</label>
            <Input
              placeholder="e.g. https://my-backend.onrender.com"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setStatus("idle");
              }}
              className="bg-black/20 border-border focus-visible:ring-primary/50"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use the default configuration.
            </p>
          </div>

          {url && (
            <div className="flex items-center gap-2 text-sm">
              Status:
              {status === "idle" && <span className="text-muted-foreground">Pending</span>}
              {status === "testing" && (
                <span className="text-primary flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Testing...
                </span>
              )}
              {status === "success" && (
                <span className="text-green-500 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="h-4 w-4" /> Connected
                </span>
              )}
              {status === "error" && (
                <span className="text-destructive flex items-center gap-1 font-medium">
                  <XCircle className="h-4 w-4" /> Unreachable
                </span>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="flex sm:justify-between sm:items-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => testConnection(url.trim())}
            disabled={!url || status === "testing"}
            className="w-full sm:w-auto"
          >
            Test Connection
          </Button>
          <Button type="button" onClick={handleSave} disabled={status === "testing"} className="w-full sm:w-auto mt-2 sm:mt-0">
            Save & Reload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
