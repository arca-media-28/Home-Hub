import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useGetMe,
  useGetConnections,
  useUpdateConnection,
  useTestConnection,
  useGetSpotifyStatus,
  useSaveSpotifyCredentials,
  useStartSpotifyAuth,
  useDisconnectSpotify,
  getGetConnectionsQueryKey,
  getGetConnectionsStatusQueryKey,
  getGetSpotifyStatusQueryKey,
  getGetMeQueryKey,
  type ServiceConnection,
  type ServiceConnectionUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import AppearanceSettings from "@/components/AppearanceSettings";
import {
  Boxes,
  ArrowLeft,
  Loader2,
  Check,
  AlertTriangle,
  Server,
  Clapperboard,
  Tv,
  Film,
  Music,
  Download,
  Shield,
  Network,
  Radar,
  Globe,
  Tv2,
  TrendingUp,
  MonitorPlay,
  ChevronDown,
  Plug,
  X,
  Copy,
  ExternalLink,
  Unplug,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { groupByCategory } from "@/lib/integrationCategories";

type ServiceKey =
  | "truenas"
  | "plex"
  | "jellyfin"
  | "sonarr"
  | "radarr"
  | "lidarr"
  | "qbittorrent"
  | "pihole"
  | "nginx-proxy-manager"
  | "prowlarr"
  | "tailscale"
  | "ersatztv"
  | "stocks";

type FieldKey = "url" | "apiKey" | "username" | "password" | "token";

interface FieldDef {
  key: FieldKey;
  label: string;
  type?: string;
  placeholder?: string;
}

interface ServiceDef {
  key: ServiceKey;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  fields: FieldDef[];
}

const URL_FIELD: FieldDef = {
  key: "url",
  label: "Base URL",
  placeholder: "http://192.168.1.10:8080",
};
const API_KEY_FIELD: FieldDef = {
  key: "apiKey",
  label: "API Key",
  type: "password",
  placeholder: "••••••••••••",
};

const SERVICES: ServiceDef[] = [
  {
    key: "truenas",
    name: "TrueNAS",
    icon: Server,
    fields: [URL_FIELD, API_KEY_FIELD],
  },
  {
    key: "plex",
    name: "Plex",
    icon: Clapperboard,
    fields: [
      URL_FIELD,
      API_KEY_FIELD,
      { key: "token", label: "Plex Token", type: "password", placeholder: "X-Plex-Token" },
    ],
  },
  {
    key: "jellyfin",
    name: "Jellyfin",
    icon: MonitorPlay,
    fields: [URL_FIELD, API_KEY_FIELD],
  },
  {
    key: "sonarr",
    name: "Sonarr",
    icon: Tv,
    fields: [URL_FIELD, API_KEY_FIELD],
  },
  {
    key: "radarr",
    name: "Radarr",
    icon: Film,
    fields: [URL_FIELD, API_KEY_FIELD],
  },
  {
    key: "lidarr",
    name: "Lidarr",
    icon: Music,
    fields: [URL_FIELD, API_KEY_FIELD],
  },
  {
    key: "qbittorrent",
    name: "qBittorrent",
    icon: Download,
    fields: [
      URL_FIELD,
      { key: "username", label: "Username", placeholder: "admin" },
      { key: "password", label: "Password", type: "password", placeholder: "••••••••" },
    ],
  },
  {
    key: "pihole",
    name: "Pi-hole",
    icon: Shield,
    fields: [URL_FIELD, API_KEY_FIELD],
  },
  {
    key: "nginx-proxy-manager",
    name: "Nginx Proxy Manager",
    icon: Network,
    fields: [
      URL_FIELD,
      { key: "username", label: "Email", placeholder: "admin@example.com" },
      { key: "password", label: "Password", type: "password", placeholder: "••••••••" },
    ],
  },
  {
    key: "prowlarr",
    name: "Prowlarr",
    icon: Radar,
    fields: [URL_FIELD, API_KEY_FIELD],
  },
  {
    key: "tailscale",
    name: "Tailscale",
    icon: Globe,
    // Tailscale is a cloud service, so there's no LAN base URL. We reuse the
    // `url` field to carry the tailnet name and `apiKey` for the API access
    // token — both are relabelled here to match.
    fields: [
      { key: "url", label: "Tailnet name", placeholder: "example.ts.net or -" },
      {
        key: "apiKey",
        label: "API access token",
        type: "password",
        placeholder: "tskey-api-••••••••",
      },
    ],
  },
  {
    key: "ersatztv",
    name: "ErsatzTV",
    icon: Tv2,
    // ErsatzTV runs without auth here, so only a base URL is needed.
    fields: [URL_FIELD],
  },
  {
    key: "stocks",
    name: "Stocks (Finnhub)",
    icon: TrendingUp,
    // Finnhub's base URL is fixed, so only an API key is needed. Without one the
    // Stocks tile falls back to sample quotes.
    fields: [API_KEY_FIELD],
  },
];

type FormState = Record<FieldKey, string>;

function connectionToForm(conn: ServiceConnection | undefined): FormState {
  return {
    url: conn?.url ?? "",
    apiKey: conn?.apiKey ?? "",
    username: conn?.username ?? "",
    password: conn?.password ?? "",
    token: conn?.token ?? "",
  };
}

function ServiceCard({
  def,
  connection,
}: {
  def: ServiceDef;
  connection: ServiceConnection | undefined;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => connectionToForm(connection));
  const [savedAt, setSavedAt] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Re-sync the form when server values load/refresh, so saved values pre-fill.
  useEffect(() => {
    setForm(connectionToForm(connection));
  }, [connection]);

  const testMutation = useTestConnection();

  const mutation = useUpdateConnection({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData<ServiceConnection[]>(
          getGetConnectionsQueryKey(),
          (old) =>
            old?.map((c) => (c.service === data.service ? data : c)) ?? [data],
        );
        // Re-ping so the dashboard's reachability badge reflects the new settings.
        queryClient.invalidateQueries({ queryKey: getGetConnectionsStatusQueryKey() });
        setSavedAt(true);
        setTimeout(() => setSavedAt(false), 2000);
      },
    },
  });

  const Icon = def.icon;

  function buildPayload(): ServiceConnectionUpdate {
    const payload: ServiceConnectionUpdate = {};
    for (const field of def.fields) {
      payload[field.key] = form[field.key];
    }
    return payload;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate(
      { service: def.key, data: buildPayload() },
      {
        onError: () => {
          toast({
            title: `Failed to save ${def.name}`,
            description: "Check your connection and try again.",
            variant: "destructive",
          });
        },
      },
    );
  }

  function handleTest() {
    setTestResult(null);
    testMutation.mutate(
      { service: def.key, data: buildPayload() },
      {
        onSuccess: (result) => setTestResult(result),
        onError: () =>
          setTestResult({ ok: false, message: "Could not reach service" }),
      },
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-border bg-card relative"
    >
      <div className="absolute top-0 left-0 h-full w-0.5 bg-primary/60" />
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
        <Icon className="w-4 h-4 text-primary" />
        <h2 className="font-bold text-sm uppercase tracking-widest text-foreground">
          {def.name}
        </h2>
      </div>

      <div className="p-5 grid gap-4 sm:grid-cols-2">
        {def.fields.map((field) => (
          <div
            key={field.key}
            className={`space-y-1.5 ${field.key === "url" ? "sm:col-span-2" : ""}`}
          >
            <Label
              htmlFor={`${def.key}-${field.key}`}
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              {field.label}
            </Label>
            <Input
              id={`${def.key}-${field.key}`}
              type={field.type ?? "text"}
              autoComplete="off"
              placeholder={field.placeholder}
              value={form[field.key]}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border">
        <div className="min-h-5 text-xs">
          {testMutation.isPending ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Testing…
            </span>
          ) : testResult ? (
            testResult.ok ? (
              <span className="flex items-center gap-1.5 text-primary">
                <Check className="w-3.5 h-3.5" />
                {testResult.message}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-destructive">
                <X className="w-3.5 h-3.5" />
                {testResult.message}
              </span>
            )
          ) : mutation.isError ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="w-3.5 h-3.5" />
              Could not save — try again.
            </span>
          ) : savedAt ? (
            <span className="flex items-center gap-1.5 text-primary">
              <Check className="w-3.5 h-3.5" />
              Saved
            </span>
          ) : connection?.updatedAt ? (
            <span className="text-muted-foreground">
              Last saved {new Date(connection.updatedAt + "Z").toLocaleString()}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleTest}
            disabled={testMutation.isPending || mutation.isPending}
            className="gap-1.5"
          >
            {testMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plug className="w-3.5 h-3.5" />
            )}
            Test
          </Button>
          <Button type="submit" size="sm" disabled={mutation.isPending} className="gap-1.5">
            {mutation.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

// Spotify needs a bespoke card: it uses OAuth (Client ID/Secret + an account
// link round-trip) rather than the simple credential form the other services
// share. The user registers their own Spotify app — no Replit integration
// exists — so we surface the exact redirect URI they must allow-list.
function SpotifyCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useGetSpotifyStatus({
    query: { queryKey: getGetSpotifyStatusQueryKey() },
  });

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const refreshStatus = () =>
    queryClient.invalidateQueries({ queryKey: getGetSpotifyStatusQueryKey() });

  const saveMutation = useSaveSpotifyCredentials({
    mutation: {
      onSuccess: (next) => {
        queryClient.setQueryData(getGetSpotifyStatusQueryKey(), next);
        toast({ title: "Spotify credentials saved" });
      },
      onError: () =>
        toast({
          title: "Couldn’t save credentials",
          description: "Check the Client ID and Secret and try again.",
          variant: "destructive",
        }),
    },
  });

  const authMutation = useStartSpotifyAuth({
    mutation: {
      onError: () =>
        toast({
          title: "Couldn’t start Spotify sign-in",
          description: "Save your Client ID and Secret first.",
          variant: "destructive",
        }),
    },
  });

  const disconnectMutation = useDisconnectSpotify({
    mutation: {
      onSuccess: (next) => {
        queryClient.setQueryData(getGetSpotifyStatusQueryKey(), next);
        toast({ title: "Spotify disconnected" });
      },
      onError: () => refreshStatus(),
    },
  });

  // The OAuth popup posts its result here when it returns; refresh status and
  // toast in this (the dashboard) tab.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== "spotify-auth") return;
      queryClient.invalidateQueries({ queryKey: getGetSpotifyStatusQueryKey() });
      if (e.data.result === "connected") {
        toast({ title: "Spotify connected" });
      } else {
        toast({
          title: "Spotify connection failed",
          description: "Please try linking your account again.",
          variant: "destructive",
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [queryClient, toast]);

  const configured = status?.configured ?? false;
  const connected = status?.connected ?? false;
  const redirectUri = status?.redirectUri ?? "";

  function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId.trim() || !clientSecret.trim()) return;
    saveMutation.mutate({ data: { clientId: clientId.trim(), clientSecret: clientSecret.trim() } });
  }

  function handleConnect() {
    // Spotify's consent page refuses to be framed (it sets frame-ancestors), and
    // the dashboard runs inside Replit's preview iframe — so navigating in-place
    // shows "accounts.spotify.com refused to connect". Open the flow in a
    // top-level popup instead. The window MUST be opened synchronously inside the
    // click handler (before the await) or the browser's popup blocker kills it.
    const popup = window.open("about:blank", "spotify-auth", "width=520,height=720");

    // Send the full base URL (host + SPA base path) so the server can build the
    // host-root redirect URI and a base-path-aware return URL.
    const origin = window.location.origin + import.meta.env.BASE_URL;
    authMutation.mutate(
      { data: { origin } },
      {
        onSuccess: (res) => {
          if (popup && !popup.closed) {
            popup.location.href = res.url;
          } else {
            // Popup was blocked — try a fresh top-level tab as a fallback.
            window.open(res.url, "_blank", "noopener");
          }
        },
        onError: () => popup?.close(),
      },
    );
  }

  function copyRedirect() {
    navigator.clipboard
      ?.writeText(redirectUri)
      .then(() => toast({ title: "Redirect URI copied" }))
      .catch(() => {
        /* clipboard blocked — user can still select the text manually */
      });
  }

  return (
    <div className="border border-border bg-card relative">
      <div className="absolute top-0 left-0 h-full w-0.5 bg-primary/60" />
      <div className="flex items-center justify-between gap-2.5 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Music className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-sm uppercase tracking-widest text-foreground">Spotify</h2>
        </div>
        {!isLoading && (
          <span
            className={`text-[10px] uppercase tracking-wider font-bold ${
              connected ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {connected ? "Connected" : configured ? "Not linked" : "Not configured"}
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        <p className="text-xs text-muted-foreground">
          Create an app at the{" "}
          <a
            href="https://developer.spotify.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-0.5 hover:underline"
          >
            Spotify Developer Dashboard
            <ExternalLink className="w-3 h-3" />
          </a>
          , then add the redirect URI below to it and paste the Client ID and Secret here.
        </p>

        {/* Redirect URI to allow-list in the Spotify app */}
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Redirect URI
          </Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate border border-border bg-muted/40 px-2 py-1.5 text-xs text-foreground">
              {redirectUri || "—"}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={copyRedirect}
              disabled={!redirectUri}
              className="gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy
            </Button>
          </div>
        </div>

        {/* Client credentials */}
        <form onSubmit={handleSaveCredentials} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label
              htmlFor="spotify-client-id"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Client ID
            </Label>
            <Input
              id="spotify-client-id"
              autoComplete="off"
              placeholder={configured ? "•••• saved ••••" : "Spotify Client ID"}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="spotify-client-secret"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Client Secret
            </Label>
            <Input
              id="spotify-client-secret"
              type="password"
              autoComplete="off"
              placeholder={configured ? "•••• saved ••••" : "Spotify Client Secret"}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2 flex items-center justify-between gap-3">
            <div className="min-h-5 text-xs">
              {connected && status?.displayName ? (
                <span className="text-muted-foreground">
                  Linked as <span className="text-foreground">{status.displayName}</span>
                  {status.premium === false && " · remote-only (no Premium)"}
                  {status.premium === true && " · Premium"}
                </span>
              ) : null}
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={saveMutation.isPending || !clientId.trim() || !clientSecret.trim()}
              className="gap-1.5"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save credentials"
              )}
            </Button>
          </div>
        </form>
      </div>

      <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border">
        <div className="text-xs text-muted-foreground">
          {connected
            ? "Your Spotify account is linked."
            : configured
              ? "Credentials saved — link your account to finish."
              : "Save credentials to enable account linking."}
        </div>
        {connected ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
            className="gap-1.5"
          >
            {disconnectMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Unplug className="w-3.5 h-3.5" />
            )}
            Disconnect
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={handleConnect}
            disabled={!configured || authMutation.isPending}
            className="gap-1.5"
          >
            {authMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plug className="w-3.5 h-3.5" />
            )}
            Connect Spotify
          </Button>
        )}
      </div>
    </div>
  );
}

// Persist each category's collapsed/expanded state in localStorage, keyed per
// category, so a user's choice survives reloads and sessions. Defaults to
// expanded the first time (matching the original behaviour).
const COLLAPSE_STORAGE_PREFIX = "settings.category.open.";

function readCategoryOpen(title: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(COLLAPSE_STORAGE_PREFIX + title);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function writeCategoryOpen(title: string, open: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSE_STORAGE_PREFIX + title, String(open));
  } catch {
    // Ignore storage failures (e.g. private mode); state stays in-memory only.
  }
}

// A collapsible group of service cards under a category heading. Expanded by
// default the first time; the collapsed state is remembered per category across
// reloads and sessions via localStorage.
function CategorySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => readCategoryOpen(title));

  function handleOpenChange(next: boolean) {
    setOpen(next);
    writeCategoryOpen(title, next);
  }

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-1 py-2 text-left">
        <ChevronDown
          className={`w-4 h-4 text-primary transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span className="font-bold text-xs uppercase tracking-widest text-foreground">
          {title}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-5 pt-1 pb-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function Settings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: me, isError: meError } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false },
  });

  useEffect(() => {
    if (meError) setLocation("/login");
  }, [meError, setLocation]);

  // Surface the result of the Spotify OAuth round-trip (the server redirects back
  // here with ?spotify=connected|error), then strip the param so it doesn't
  // re-fire on refresh.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("spotify");
    if (!result) return;

    // When this page is the OAuth popup (opened by handleConnect), hand the
    // result back to the dashboard tab and close — the opener refreshes status
    // and shows the toast. Same-origin, so opener access is allowed.
    if (window.opener && window.opener !== window) {
      try {
        window.opener.postMessage(
          { type: "spotify-auth", result },
          window.location.origin,
        );
      } catch {
        /* opener gone/blocked — fall through to top-level handling below */
      }
      window.close();
      return;
    }

    if (result === "connected") {
      toast({ title: "Spotify connected" });
    } else if (result === "error") {
      toast({
        title: "Spotify connection failed",
        description: "Please try linking your account again.",
        variant: "destructive",
      });
    }
    params.delete("spotify");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (query ? `?${query}` : ""),
    );
  }, [toast]);

  const {
    data: connections,
    isLoading,
    isError,
  } = useGetConnections({
    query: { queryKey: getGetConnectionsQueryKey(), enabled: Boolean(me) },
  });

  useEffect(() => {
    if (isError) {
      toast({
        title: "Failed to load settings",
        description: "Could not reach the server.",
        variant: "destructive",
      });
    }
  }, [isError, toast]);

  const byService = new Map(
    (connections ?? []).map((c) => [c.service, c]),
  );

  return (
    <div className="min-h-screen bg-background bg-dot-pattern">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-screen-md mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Boxes className="w-5 h-5 text-primary" />
            <span className="font-bold text-sm uppercase tracking-widest text-foreground">
              Settings
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setLocation("/")}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Dashboard
          </Button>
        </div>
      </header>

      <main className="max-w-screen-md mx-auto px-4 py-6">
        <AppearanceSettings />

        <div className="mb-6">
          <h1 className="font-bold uppercase tracking-widest text-foreground">
            Service connections
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connection details are stored on the host and shared across all
            browsers pointing to this dashboard.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            <span className="text-primary">{"> "}</span>
            <span className="animate-pulse">Loading settings…</span>
          </div>
        ) : (
          <div className="space-y-4">
            {groupByCategory(SERVICES, (def) => def.key).map((group) => (
              <CategorySection key={group.category} title={group.category}>
                {group.items.map((def) => (
                  <ServiceCard
                    key={def.key}
                    def={def}
                    connection={byService.get(def.key)}
                  />
                ))}
                {/* Spotify lives in Media but uses its own OAuth card. */}
                {group.category === "Media" && <SpotifyCard />}
              </CategorySection>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
