import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useGetMe,
  useGetConnections,
  useUpdateConnection,
  useTestConnection,
  getGetConnectionsQueryKey,
  getGetConnectionsStatusQueryKey,
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
  Download,
  Shield,
  Network,
  Radar,
  Plug,
  X,
} from "lucide-react";

type ServiceKey =
  | "truenas"
  | "plex"
  | "sonarr"
  | "radarr"
  | "qbittorrent"
  | "pihole"
  | "nginx-proxy-manager"
  | "prowlarr";

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

export default function Settings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: me, isError: meError } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false },
  });

  useEffect(() => {
    if (meError) setLocation("/login");
  }, [meError, setLocation]);

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
          <div className="space-y-5">
            {SERVICES.map((def) => (
              <ServiceCard
                key={def.key}
                def={def}
                connection={byService.get(def.key)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
