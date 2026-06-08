import { AlertTriangle } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background bg-dot-pattern p-4">
      <div className="w-full max-w-md relative border border-border bg-card p-8 shadow-2xl">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-destructive" />

        <div className="flex items-center gap-3 mb-3">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          <h1 className="text-lg font-bold uppercase tracking-widest text-foreground">
            404 — Not Found
          </h1>
        </div>

        <p className="text-sm text-muted-foreground">
          <span className="text-primary select-none">{"> "}</span>
          The requested route does not exist on this host.
        </p>

        <div className="mt-6 pt-6 border-t border-border">
          <Link
            href="/"
            className="text-xs uppercase tracking-wider text-primary hover:text-foreground underline decoration-primary/30 underline-offset-4 transition-colors"
          >
            Return to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
