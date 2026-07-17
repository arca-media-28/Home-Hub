import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useGetMe,
  useGetConnections,
  useUpdateConnection,
  useTestConnection,
  getTruenasDiagnostics,
  ApiError,
  useGetSpotifyStatus,
  useSaveSpotifyCredentials,
  useStartSpotifyAuth,
  useDisconnectSpotify,
  useGetGoogleStatus,
  useDisconnectGoogle,
  useSetGoogleCredentials,
  useClearGoogleCredentials,
  createGoogleAuthIntent,
  useListImapAccounts,
  useAddImapAccount,
  useRemoveImapAccount,
  useListCalDavAccounts,
  useAddCalDavAccount,
  useRemoveCalDavAccount,
  getGetConnectionsQueryKey,
  getGetConnectionsStatusQueryKey,
  getGetSpotifyStatusQueryKey,
  getGetGoogleStatusQueryKey,
  getListImapAccountsQueryKey,
  getListCalDavAccountsQueryKey,
  getGetMeQueryKey,
  type ServiceConnection,
  type ServiceConnectionUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
  Gamepad2,
  Globe,
  Tv2,
  TrendingUp,
  MonitorPlay,
  ChevronDown,
  Plug,
  Stethoscope,
  X,
  Copy,
  ExternalLink,
  Unplug,
  Mail,
  CalendarDays,
  Trash2,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { groupByCategory } from "@/lib/integrationCategories";

// Copy text to the clipboard, returning whether it succeeded. The async
// Clipboard API only exists in secure contexts (HTTPS or localhost); a
// self-hosted dashboard reached over plain HTTP on the LAN has no
// `navigator.clipboard`, so fall back to a hidden textarea + execCommand.
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path (e.g. permission denied).
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

type ServiceKey =
  | "truenas"
  | "plex"
  | "jellyfin"
  | "subsonic"
  | "sonarr"
  | "radarr"
  | "lidarr"
  | "qbittorrent"
  | "pihole"
  | "nginx-proxy-manager"
  | "prowlarr"
  | "pterodactyl"
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
    key: "subsonic",
    name: "Navidrome / Subsonic",
    icon: Music,
    // Subsonic-compatible servers (Navidrome, Airsonic, Gonic) authenticate with
    // a username + password using a salted token the backend derives per request.
    fields: [
      URL_FIELD,
      { key: "username", label: "Username", placeholder: "admin" },
      { key: "password", label: "Password", type: "password", placeholder: "••••••••" },
    ],
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
    key: "pterodactyl",
    name: "Pterodactyl",
    icon: Gamepad2,
    // The game panel's client API authenticates with a per-user client API key
    // (Account Settings → API Credentials in the panel).
    fields: [
      { key: "url", label: "Panel URL", placeholder: "https://panel.example.com" },
      {
        key: "apiKey",
        label: "Client API Key",
        type: "password",
        placeholder: "ptlc_••••••••",
      },
    ],
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
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagOutput, setDiagOutput] = useState<string | null>(null);
  const [diagCopied, setDiagCopied] = useState(false);

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

  async function handleDiagnostics() {
    setDiagRunning(true);
    setDiagCopied(false);
    setDiagOutput(null);
    try {
      const data = await getTruenasDiagnostics();
      setDiagOutput(JSON.stringify(data, null, 2));
    } catch (err) {
      // A 409 (not configured) or upstream failure still carries a useful body.
      if (err instanceof ApiError && err.data != null) {
        setDiagOutput(JSON.stringify(err.data, null, 2));
      } else {
        setDiagOutput(
          JSON.stringify(
            { error: err instanceof Error ? err.message : String(err) },
            null,
            2,
          ),
        );
      }
    } finally {
      setDiagRunning(false);
    }
  }

  async function handleCopyDiagnostics() {
    if (!diagOutput) return;
    if (await copyText(diagOutput)) {
      setDiagCopied(true);
      setTimeout(() => setDiagCopied(false), 2000);
    } else {
      toast({
        title: "Couldn't copy",
        description: "Select the text and copy it manually.",
        variant: "destructive",
      });
    }
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
          {def.key === "truenas" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleDiagnostics}
              disabled={diagRunning || mutation.isPending}
              className="gap-1.5"
            >
              {diagRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Stethoscope className="w-3.5 h-3.5" />
              )}
              Diagnostics
            </Button>
          )}
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

      {def.key === "truenas" && diagOutput !== null && (
        <div className="border-t border-border px-5 py-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Reporting diagnostic (runs against your saved TrueNAS settings —
              click Save first if you just changed them). Copy this and paste it
              back so the CPU/RAM metrics can be fixed for your TrueNAS version.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCopyDiagnostics}
              className="gap-1.5 shrink-0"
            >
              {diagCopied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {diagCopied ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre className="max-h-80 overflow-auto bg-muted/50 border border-border p-3 text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
            {diagOutput}
          </pre>
        </div>
      )}
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

  async function copyRedirect() {
    if (await copyText(redirectUri)) toast({ title: "Redirect URI copied" });
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

function GoogleCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useGetGoogleStatus({
    query: { queryKey: getGetGoogleStatusQueryKey() },
  });

  const [clientIdInput, setClientIdInput] = useState("");
  const [clientSecretInput, setClientSecretInput] = useState("");
  const [editingCredentials, setEditingCredentials] = useState(false);

  const saveCredentialsMutation = useSetGoogleCredentials({
    mutation: {
      onSuccess: (next) => {
        queryClient.setQueryData(getGetGoogleStatusQueryKey(), next);
        setClientIdInput("");
        setClientSecretInput("");
        setEditingCredentials(false);
        toast({
          title: "Google credentials saved",
          description: "Now click Connect Google to link your account.",
        });
      },
      onError: (err) => {
        queryClient.invalidateQueries({ queryKey: getGetGoogleStatusQueryKey() });
        toast({
          title: "Couldn’t save credentials",
          description: err instanceof ApiError ? err.message : "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const clearCredentialsMutation = useClearGoogleCredentials({
    mutation: {
      onSuccess: (next) => {
        queryClient.setQueryData(getGetGoogleStatusQueryKey(), next);
        toast({ title: "Google credentials removed" });
      },
      onError: () =>
        queryClient.invalidateQueries({ queryKey: getGetGoogleStatusQueryKey() }),
    },
  });

  const disconnectMutation = useDisconnectGoogle({
    mutation: {
      onSuccess: (next) => {
        queryClient.setQueryData(getGetGoogleStatusQueryKey(), next);
        toast({ title: "Google disconnected" });
      },
      onError: () =>
        queryClient.invalidateQueries({ queryKey: getGetGoogleStatusQueryKey() }),
    },
  });

  // When the popup fails (or closes before ever reaching our callback — the
  // classic redirect_uri_mismatch dead end happens entirely on Google's page),
  // this holds a failure reason so the card can render targeted help.
  // "no-callback" = popup closed without posting a result.
  const [connectFailure, setConnectFailure] = useState<string | null>(null);
  // True once the popup posted a result; the popup-close watcher checks this
  // to distinguish a normal close from a dead-end abandon.
  const authSettledRef = useRef(false);
  const popupWatchRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (popupWatchRef.current !== null) window.clearInterval(popupWatchRef.current);
    },
    [],
  );

  // The OAuth popup posts its result here when it returns; refresh status and
  // toast in this (the dashboard) tab.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== "google-auth") return;
      authSettledRef.current = true;
      if (popupWatchRef.current !== null) {
        window.clearInterval(popupWatchRef.current);
        popupWatchRef.current = null;
      }
      queryClient.invalidateQueries({ queryKey: getGetGoogleStatusQueryKey() });
      if (e.data.result === "connected") {
        setConnectFailure(null);
        toast({ title: "Google account connected" });
      } else {
        setConnectFailure(typeof e.data.reason === "string" ? e.data.reason : "unknown");
        toast({
          title: "Google connection failed",
          description: "See the Google card for what to check.",
          variant: "destructive",
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [queryClient, toast]);

  const configured = status?.configured ?? false;
  const connected = status?.connected ?? false;
  const accounts = status?.accounts ?? [];
  const redirectUri = status?.redirectUri ?? "";
  const credentialSource = status?.credentialSource ?? null;
  const activeClientId = status?.clientId ?? null;
  const fromEnv = credentialSource === "env";
  const showCredentialForm = !fromEnv && (!configured || editingCredentials);

  function handleSaveCredentials() {
    saveCredentialsMutation.mutate({
      data: { clientId: clientIdInput.trim(), clientSecret: clientSecretInput.trim() },
    });
  }

  async function handleConnect() {
    // Google's consent page refuses to be framed, and the dashboard may run
    // inside an iframe — open the flow in a top-level popup. The auth endpoint
    // is an unauthenticated GET redirect, so it requires a short-lived
    // single-use intent token minted here (with the bearer token) first;
    // otherwise anyone could start the flow and bind their own account.
    // Open the popup synchronously so the click isn't lost to popup blockers,
    // then point it at the auth URL once the intent arrives.
    const popup = window.open("about:blank", "google-auth", "width=520,height=720");
    authSettledRef.current = false;
    setConnectFailure(null);
    try {
      const { intent } = await createGoogleAuthIntent();
      const origin = window.location.origin + import.meta.env.BASE_URL;
      const url =
        `${import.meta.env.BASE_URL}api/widgets/gmail/auth` +
        `?origin=${encodeURIComponent(origin)}&intent=${encodeURIComponent(intent)}`;
      if (popup) {
        popup.location.href = url;
        // Watch for the popup closing without ever reaching our callback —
        // that's what a redirect_uri_mismatch dead end on Google's own error
        // page looks like from here (no result is ever posted back).
        if (popupWatchRef.current !== null) window.clearInterval(popupWatchRef.current);
        popupWatchRef.current = window.setInterval(() => {
          if (!popup.closed) return;
          if (popupWatchRef.current !== null) {
            window.clearInterval(popupWatchRef.current);
            popupWatchRef.current = null;
          }
          // Give a just-posted result message a moment to arrive first.
          window.setTimeout(() => {
            if (!authSettledRef.current) setConnectFailure("no-callback");
          }, 500);
        }, 1000);
      } else {
        // Popup was blocked — try a fresh top-level tab as a fallback.
        window.open(url, "_blank", "noopener");
      }
    } catch {
      popup?.close();
      toast({
        title: "Couldn’t start Google sign-in",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function copyRedirect() {
    if (await copyText(redirectUri)) toast({ title: "Redirect URI copied" });
  }

  return (
    <div className="border border-border bg-card relative">
      <div className="absolute top-0 left-0 h-full w-0.5 bg-primary/60" />
      <div className="flex items-center justify-between gap-2.5 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Mail className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-sm uppercase tracking-widest text-foreground">
            Google (Gmail + Calendar)
          </h2>
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
          One Google sign-in powers both the Email tile (Gmail inbox) and the
          Calendar tile (Google Calendar). Google requires each app that reads
          your mail or calendar to have its own free OAuth credentials, so a
          one-time setup in the Google Cloud Console is needed before you can
          connect your account.
        </p>

        {!connected && (
          <ol className="list-decimal list-inside space-y-1.5 text-xs text-muted-foreground border border-border bg-muted/20 px-4 py-3">
            <li>
              Open the{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-0.5 hover:underline"
              >
                Google Cloud Console credentials page
                <ExternalLink className="w-3 h-3" />
              </a>{" "}
              and create (or select) a project.
            </li>
            <li>
              Enable the <span className="text-foreground">Gmail API</span> and{" "}
              <span className="text-foreground">Google Calendar API</span> under{" "}
              <a
                href="https://console.cloud.google.com/apis/library"
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-0.5 hover:underline"
              >
                APIs &amp; Services → Library
                <ExternalLink className="w-3 h-3" />
              </a>
              .
            </li>
            <li>
              Configure the OAuth consent screen (choose{" "}
              <span className="text-foreground">External</span> and add your own
              Google address as a test user).
            </li>
            <li>
              Create credentials: <span className="text-foreground">OAuth client ID</span>{" "}
              → application type <span className="text-foreground">Web application</span>,
              and paste the Redirect URI below into{" "}
              <span className="text-foreground">Authorized redirect URIs</span>.
            </li>
            <li>
              Copy the generated <span className="text-foreground">Client ID</span> and{" "}
              <span className="text-foreground">Client secret</span> into the fields
              below and save.
            </li>
            <li>
              Click <span className="text-foreground">Connect Google</span> and sign in
              with the account whose mail and calendar you want on the dashboard.
            </li>
          </ol>
        )}

        {/* Targeted help when the OAuth popup failed or never came back. The
            most common dead end is Google's "Error 400: redirect_uri_mismatch"
            page, which the user only ever sees inside the popup. */}
        {connectFailure && (
          <div className="border border-destructive/50 bg-destructive/10 px-4 py-3 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-destructive font-bold uppercase tracking-wider">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {connectFailure === "denied"
                ? "Access was declined"
                : "Google sign-in didn’t complete"}
            </div>
            {connectFailure === "denied" ? (
              <p className="text-muted-foreground">
                Google reported that access was declined. Click Connect Google
                again and approve the requested permissions to link the account.
              </p>
            ) : connectFailure === "expired" ? (
              <p className="text-muted-foreground">
                The sign-in attempt expired before it finished. Click Connect
                Google to start a fresh attempt.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  If Google showed{" "}
                  <span className="text-foreground">
                    “Error 400: redirect_uri_mismatch”
                  </span>
                  , the redirect URI below isn’t registered on your OAuth
                  client. Open{" "}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary inline-flex items-center gap-0.5 hover:underline"
                  >
                    Google Cloud Console → Credentials
                    <ExternalLink className="w-3 h-3" />
                  </a>{" "}
                  and add it under{" "}
                  <span className="text-foreground">Authorized redirect URIs</span>:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate border border-border bg-muted/40 px-2 py-1.5 text-foreground">
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
                <p className="text-muted-foreground">
                  It must match{" "}
                  <span className="text-foreground">character-for-character</span>{" "}
                  (scheme, host, port, and path — the easiest way is the Copy
                  button). If Google’s error page shows the URI it received,
                  register exactly that value. Changes in Google Cloud Console
                  can take a few minutes to apply, so wait a moment before
                  trying again.
                </p>
              </>
            )}
          </div>
        )}

        {/* Redirect URI to allow-list in the Google OAuth app */}
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
          {!connected && (
            <p className="text-xs text-muted-foreground">
              Copy this exact URI into your OAuth client’s{" "}
              <span className="text-foreground">Authorized redirect URIs</span>{" "}
              in Google Cloud Console <span className="text-foreground">before</span>{" "}
              clicking Connect — otherwise Google stops the sign-in with a{" "}
              <span className="text-foreground">redirect_uri_mismatch</span> error.
              Changes there take a few minutes to apply.
            </p>
          )}
        </div>

        {fromEnv ? (
          <p className="text-xs text-muted-foreground border border-border bg-muted/20 px-4 py-3">
            Credentials are provided by the server’s{" "}
            <code className="text-foreground">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="text-foreground">GOOGLE_CLIENT_SECRET</code>{" "}
            environment variables, so they can’t be edited here.
          </p>
        ) : showCredentialForm ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="google-client-id"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Client ID
                </Label>
                <Input
                  id="google-client-id"
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                  placeholder="1234567890-abc123.apps.googleusercontent.com"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="google-client-secret"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Client Secret
                </Label>
                <Input
                  id="google-client-secret"
                  type="password"
                  value={clientSecretInput}
                  onChange={(e) => setClientSecretInput(e.target.value)}
                  placeholder="GOCSPX-…"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleSaveCredentials}
                disabled={
                  !clientIdInput.trim() ||
                  !clientSecretInput.trim() ||
                  saveCredentialsMutation.isPending
                }
                className="gap-1.5"
              >
                {saveCredentialsMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Save Credentials
              </Button>
              {editingCredentials && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditingCredentials(false);
                    setClientIdInput("");
                    setClientSecretInput("");
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 border border-border bg-muted/20 px-4 py-3">
            <div className="min-w-0 text-xs text-muted-foreground">
              <span className="uppercase tracking-wider font-bold">Client ID:&nbsp;</span>
              <code className="text-foreground break-all">{activeClientId ?? "—"}</code>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditingCredentials(true)}
              >
                Change
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => clearCredentialsMutation.mutate()}
                disabled={clearCredentialsMutation.isPending}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Remove Google credentials"
              >
                {clearCredentialsMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-4 border-t border-border space-y-3">
        {accounts.length > 0 && (
          <ul className="space-y-2">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="flex items-center justify-between gap-2 border border-border bg-muted/20 px-4 py-2.5"
              >
                <div className="min-w-0 flex items-center gap-2 text-xs">
                  <span
                    className={`w-1.5 h-1.5 shrink-0 rounded-full ${
                      account.connected ? "bg-primary" : "bg-destructive"
                    }`}
                    aria-hidden
                  />
                  <span className="truncate text-foreground">
                    {account.email ?? "Google account"}
                  </span>
                  {!account.connected && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-destructive">
                      needs reconnect
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => disconnectMutation.mutate({ data: { accountId: account.id } })}
                  disabled={disconnectMutation.isPending}
                  className="gap-1.5 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Disconnect ${account.email ?? "Google account"}`}
                >
                  <Unplug className="w-3.5 h-3.5" />
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {accounts.length > 0 ? (
              "Each linked account can be shown on its own Email or Calendar tile."
            ) : configured ? (
              "Credentials saved — click Connect Google to link your account."
            ) : (
              "Follow the steps above, then save your credentials to enable linking."
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant={accounts.length > 0 ? "outline" : "default"}
            onClick={handleConnect}
            disabled={!configured}
            className="gap-1.5 shrink-0"
          >
            <Plug className="w-3.5 h-3.5" />
            {accounts.length > 0 ? "Connect another account" : "Connect Google"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ImapAccountsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: accounts, isLoading } = useListImapAccounts({
    query: { queryKey: getListImapAccountsQueryKey() },
  });

  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [secure, setSecure] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [webmailUrl, setWebmailUrl] = useState("");

  const addMutation = useAddImapAccount({
    mutation: {
      onSuccess: (next) => {
        queryClient.setQueryData(getListImapAccountsQueryKey(), next);
        setLabel("");
        setHost("");
        setPort("993");
        setSecure(true);
        setUsername("");
        setPassword("");
        setWebmailUrl("");
        toast({ title: "IMAP account added" });
      },
      onError: (err) =>
        toast({
          title: "Couldn’t add IMAP account",
          description: err instanceof ApiError ? err.message : "Check the details and try again.",
          variant: "destructive",
        }),
    },
  });

  const removeMutation = useRemoveImapAccount({
    mutation: {
      onSuccess: (next) => {
        queryClient.setQueryData(getListImapAccountsQueryKey(), next);
        toast({ title: "IMAP account removed" });
      },
      onError: () =>
        queryClient.invalidateQueries({ queryKey: getListImapAccountsQueryKey() }),
    },
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!host.trim() || !username.trim() || !password) return;
    const portNum = Number.parseInt(port, 10);
    addMutation.mutate({
      data: {
        label: label.trim() || null,
        host: host.trim(),
        port: Number.isFinite(portNum) && portNum > 0 ? portNum : null,
        secure,
        username: username.trim(),
        password,
        webmailUrl: webmailUrl.trim() || null,
      },
    });
  }

  return (
    <div className="border border-border bg-card relative">
      <div className="absolute top-0 left-0 h-full w-0.5 bg-primary/60" />
      <div className="flex items-center justify-between gap-2.5 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Mail className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-sm uppercase tracking-widest text-foreground">
            IMAP Mail Accounts
          </h2>
        </div>
        {!isLoading && (
          <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
            {(accounts ?? []).length > 0
              ? `${(accounts ?? []).length} account${(accounts ?? []).length === 1 ? "" : "s"}`
              : "None"}
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        <p className="text-xs text-muted-foreground">
          Add any standard IMAP mailbox (Fastmail, iCloud, a self-hosted server,
          …) to show it on the Email tile. Passwords are stored on the host and
          never sent back to the browser — for most providers use an
          app-specific password.
        </p>

        {(accounts ?? []).length > 0 && (
          <ul className="space-y-2">
            {(accounts ?? []).map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 border border-border bg-muted/30 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm text-foreground truncate">{a.label}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {a.username} @ {a.host}:{a.port}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeMutation.mutate({ id: a.id })}
                  disabled={removeMutation.isPending}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${a.label}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Label (optional)
            </Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Personal mail"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              IMAP host
            </Label>
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="imap.fastmail.com"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Port
            </Label>
            <Input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder={secure ? "993" : "143"}
              inputMode="numeric"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="imap-secure"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Use SSL/TLS
            </Label>
            <div className="flex items-center gap-2.5 h-9">
              <Switch
                id="imap-secure"
                checked={secure}
                onCheckedChange={(checked) => {
                  setSecure(checked);
                  // Swap the default port along with the mode, but only if the
                  // user hasn't typed a custom one.
                  if (checked && port === "143") setPort("993");
                  if (!checked && port === "993") setPort("143");
                }}
              />
              <span className="text-xs text-muted-foreground">
                {secure ? "Implicit TLS (usually port 993)" : "Plain / STARTTLS (usually port 143)"}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Username
            </Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="you@example.com"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Password
            </Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="App password"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Webmail URL (optional)
            </Label>
            <Input
              value={webmailUrl}
              onChange={(e) => setWebmailUrl(e.target.value)}
              placeholder="https://mail.example.com"
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">
              When set, clicking a message on the Email tile opens this webmail
              in a new tab.
            </p>
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={
                addMutation.isPending || !host.trim() || !username.trim() || !password
              }
              className="gap-1.5"
            >
              {addMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Adding…
                </>
              ) : (
                "Add account"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CalDavAccountsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: accounts, isLoading } = useListCalDavAccounts({
    query: { queryKey: getListCalDavAccountsQueryKey() },
  });

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const addMutation = useAddCalDavAccount({
    mutation: {
      onSuccess: (next) => {
        queryClient.setQueryData(getListCalDavAccountsQueryKey(), next);
        setLabel("");
        setUrl("");
        setUsername("");
        setPassword("");
        toast({ title: "CalDAV account added" });
      },
      onError: (err) =>
        toast({
          title: "Couldn’t add CalDAV account",
          description: err instanceof ApiError ? err.message : "Check the details and try again.",
          variant: "destructive",
        }),
    },
  });

  const removeMutation = useRemoveCalDavAccount({
    mutation: {
      onSuccess: (next) => {
        queryClient.setQueryData(getListCalDavAccountsQueryKey(), next);
        toast({ title: "CalDAV account removed" });
      },
      onError: () =>
        queryClient.invalidateQueries({ queryKey: getListCalDavAccountsQueryKey() }),
    },
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !username.trim() || !password) return;
    addMutation.mutate({
      data: {
        label: label.trim() || null,
        url: url.trim(),
        username: username.trim(),
        password,
      },
    });
  }

  return (
    <div className="border border-border bg-card relative">
      <div className="absolute top-0 left-0 h-full w-0.5 bg-primary/60" />
      <div className="flex items-center justify-between gap-2.5 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-sm uppercase tracking-widest text-foreground">
            CalDAV Calendars
          </h2>
        </div>
        {!isLoading && (
          <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
            {(accounts ?? []).length > 0
              ? `${(accounts ?? []).length} account${(accounts ?? []).length === 1 ? "" : "s"}`
              : "None"}
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        <p className="text-xs text-muted-foreground">
          Add any CalDAV calendar (Nextcloud, Radicale, Fastmail, iCloud, …) to
          show its events on the Calendar tile. Passwords are stored on the
          host and never sent back to the browser.
        </p>

        {(accounts ?? []).length > 0 && (
          <ul className="space-y-2">
            {(accounts ?? []).map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 border border-border bg-muted/30 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm text-foreground truncate">{a.label}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {a.username} @ {a.url}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeMutation.mutate({ id: a.id })}
                  disabled={removeMutation.isPending}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${a.label}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Label (optional)
            </Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Family calendar"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Server URL
            </Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://cloud.example.com/remote.php/dav"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Username
            </Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="you@example.com"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Password
            </Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="App password"
              autoComplete="new-password"
            />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={
                addMutation.isPending || !url.trim() || !username.trim() || !password
              }
              className="gap-1.5"
            >
              {addMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Adding…
                </>
              ) : (
                "Add account"
              )}
            </Button>
          </div>
        </form>
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

  // Surface the result of an OAuth round-trip (the server redirects back here
  // with ?spotify=connected|error or ?google=connected|error), then strip the
  // param so it doesn't re-fire on refresh.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Each entry: query param name → postMessage type + display name.
    const flows = [
      { param: "spotify", type: "spotify-auth", name: "Spotify" },
      { param: "google", type: "google-auth", name: "Google" },
    ];
    const flow = flows.find((f) => params.get(f.param));
    if (!flow) return;
    const result = params.get(flow.param)!;
    // Optional failure detail (e.g. google_reason=redirect) so the card can
    // show targeted help instead of a generic error.
    const reason = params.get(`${flow.param}_reason`);

    // When this page is the OAuth popup (opened by handleConnect), hand the
    // result back to the dashboard tab and close — the opener refreshes status
    // and shows the toast. Same-origin, so opener access is allowed.
    if (window.opener && window.opener !== window) {
      try {
        window.opener.postMessage(
          { type: flow.type, result, reason },
          window.location.origin,
        );
      } catch {
        /* opener gone/blocked — fall through to top-level handling below */
      }
      window.close();
      return;
    }

    if (flow.param === "google") {
      // The popup-blocked fallback opens the flow in a top-level tab, so the
      // redirect lands here instead of in a popup. Forward the result to the
      // GoogleCard listener (same window receives self-posted messages) so it
      // can show the targeted redirect-URI help — it also handles the toast.
      window.postMessage({ type: flow.type, result, reason }, window.location.origin);
    } else if (result === "connected") {
      toast({ title: `${flow.name} connected` });
    } else if (result === "error") {
      toast({
        title: `${flow.name} connection failed`,
        description: "Please try linking your account again.",
        variant: "destructive",
      });
    }
    params.delete(flow.param);
    params.delete(`${flow.param}_reason`);
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
            {/* Communication has no generic ServiceCard entries — its cards are
                all bespoke (Google OAuth + multi-account IMAP/CalDAV lists). */}
            <CategorySection title="Communication">
              <GoogleCard />
              <ImapAccountsCard />
              <CalDavAccountsCard />
            </CategorySection>
          </div>
        )}
      </main>
    </div>
  );
}
