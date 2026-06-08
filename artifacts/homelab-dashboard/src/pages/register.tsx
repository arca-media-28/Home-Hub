import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useRegister } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Terminal, User, Lock, ChevronRight } from "lucide-react";

export default function Register() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const register = useRegister();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    register.mutate(
      { data: { username, password } },
      {
        onSuccess: (data) => {
          localStorage.setItem("token", data.token);
          setLocation("/");
        },
        onError: (err) => {
          toast({
            title: "Registration failed",
            description: err.message || "Could not create your account.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4 relative overflow-hidden bg-dot-pattern">
      <div className="w-full max-w-md relative z-10 border border-border bg-card p-8 shadow-2xl">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-primary" />

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Terminal className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground uppercase tracking-widest">
              Create an account
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Get started with your new homelab dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label
              htmlFor="username"
              className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary"
            >
              <User className="w-3.5 h-3.5" />
              Username
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary select-none">
                {">"}
              </span>
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={register.isPending}
                className="w-full bg-background border border-border focus:border-primary text-foreground px-8 py-3 outline-none transition-colors placeholder:text-muted-foreground disabled:opacity-50"
                placeholder="admin"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary"
            >
              <Lock className="w-3.5 h-3.5" />
              Password
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary select-none">
                {">"}
              </span>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={register.isPending}
                className="w-full bg-background border border-border focus:border-primary text-foreground px-8 py-3 outline-none transition-colors placeholder:text-muted-foreground disabled:opacity-50"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={register.isPending}
            className="w-full bg-primary hover:opacity-90 text-primary-foreground font-bold uppercase tracking-widest py-3 px-4 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-70"
          >
            {register.isPending ? (
              <span className="animate-pulse">Creating account...</span>
            ) : (
              <>
                <span>Sign up</span>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-primary hover:text-foreground underline decoration-primary/30 underline-offset-4 transition-colors"
            >
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
