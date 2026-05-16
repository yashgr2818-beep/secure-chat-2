import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, Fingerprint, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useSignup } from "@workspace/api-client-react";
import { setToken, setMe } from "@/lib/auth";
import { connectWS } from "@/lib/websocket";
import { generateKeyPair, exportPublicKey, storePrivateKey } from "@/lib/crypto";

const formSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(32),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const signupMutation = useSignup();
  const [isGenerating, setIsGenerating] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      setIsGenerating(true);
      // 1. Generate RSA-OAEP key pair
      const pair = await generateKeyPair();
      
      // 2. Export public key as JWK string
      const publicKey = await exportPublicKey(pair.publicKey);
      
      // 3. Store private key in IndexedDB under username
      await storePrivateKey(values.username, pair.privateKey);
      
      // 4. Call signup
      signupMutation.mutate(
        { data: { username: values.username, password: values.password, publicKey } },
        {
          onSuccess: (data) => {
            setToken(data.token);
            setMe({ username: data.user.username });
            connectWS(data.token);
            setLocation("/");
          },
          onError: (err: any) => {
            toast({
              title: "Registration Failed",
              description: err.error || "An error occurred during registration.",
              variant: "destructive",
            });
            setIsGenerating(false);
          },
        }
      );
    } catch (error) {
      console.error("Crypto error:", error);
      toast({
        title: "Key Generation Failed",
        description: "Could not generate cryptographic keys. Your browser might not support this feature.",
        variant: "destructive",
      });
      setIsGenerating(false);
    }
  };

  const isLoading = signupMutation.isPending || isGenerating;

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-background selection:bg-primary/30">
      <Card className="w-full max-w-md border-border/50 shadow-2xl bg-card/50 backdrop-blur-sm">
        <CardHeader className="space-y-3 pb-6">
          <div className="flex justify-center mb-2">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center ring-1 ring-primary/30">
              <Fingerprint className="h-6 w-6 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl text-center font-semibold tracking-tight">Establish Identity</CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            Generate cryptographic keys and register your identity on the network.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80">Username</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Choose an alias" 
                        {...field} 
                        className="bg-black/20 border-border focus-visible:ring-primary/50 transition-all"
                        autoComplete="off"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80">Passphrase</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input 
                          type="password" 
                          placeholder="••••••••" 
                          {...field} 
                          className="bg-black/20 border-border focus-visible:ring-primary/50 transition-all pl-9"
                          autoComplete="new-password"
                        />
                        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      </div>
                    </FormControl>
                    <FormDescription className="text-xs">
                      Used to protect your account. Your private keys are stored securely on this device.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button 
                type="submit" 
                className="w-full mt-2 font-medium tracking-wide bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating Keys & Registering
                  </>
                ) : (
                  "Generate Identity"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex justify-center border-t border-border/50 pt-6">
          <p className="text-sm text-muted-foreground">
            Already registered?{" "}
            <Link href="/login" className="text-primary hover:underline hover:text-primary/80 transition-colors font-medium">
              Authenticate
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
