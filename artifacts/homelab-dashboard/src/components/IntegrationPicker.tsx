import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { groupByCategory } from "@/lib/integrationCategories";
import { integrationMeta, INTEGRATION_SERVICE, NONE } from "@/lib/integrationMeta";
import type { ServiceStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

export interface IntegrationOption {
  value: string;
  label: string;
}

// A sub-choice shown in the picker's second pop-out for an integration that has
// variants (e.g. TrueNAS, whose per-metric tiles each get their own card).
export interface IntegrationSubOption {
  key: string;
  label: string;
  description?: string;
}

interface IntegrationPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Currently selected integration value ("none" for a plain app tile).
  value: string;
  // Fired with the chosen value; the picker closes itself afterwards. For an
  // integration with sub-options, `subKey` carries the chosen variant.
  onSelect: (value: string, subKey?: string) => void;
  // Selectable integrations (excluding "None"), in within-category order.
  integrations: readonly IntegrationOption[];
  // Reachability of saved connections, used to draw a status dot where known.
  statuses?: ServiceStatus[];
  // Integrations that, when clicked, open a second pop-out of variant choices
  // instead of being selected immediately. Keyed by integration value.
  subOptions?: Record<string, IntegrationSubOption[]>;
  // The currently selected sub-option key (for highlighting in the 2nd view).
  subValue?: string;
}

// A single integration choice rendered as an app-store style card button.
function IntegrationCard({
  option,
  selected,
  status,
  onSelect,
  selectedRef,
}: {
  option: IntegrationOption;
  selected: boolean;
  status?: ServiceStatus;
  onSelect: (value: string) => void;
  selectedRef?: React.Ref<HTMLButtonElement>;
}) {
  const meta = integrationMeta(option.value);
  const Icon = meta.icon;
  // Only show a reachability dot once a connection is saved for the service.
  const showDot = Boolean(status?.configured);

  return (
    <button
      type="button"
      ref={selectedRef}
      aria-pressed={selected}
      onClick={() => onSelect(option.value)}
      className={cn(
        "group relative flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-card hover:border-primary/50 hover:bg-accent",
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md",
          selected ? "bg-primary/20 text-primary" : "bg-muted text-foreground",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{option.label}</span>
          {showDot && (
            <span
              className={cn(
                "h-2 w-2 flex-shrink-0 rounded-full",
                status?.ok ? "bg-green-500" : "bg-red-500",
              )}
              title={status?.ok ? "Reachable" : "Unreachable"}
              aria-label={status?.ok ? "Reachable" : "Unreachable"}
            />
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {meta.description}
        </span>
      </span>
    </button>
  );
}

export default function IntegrationPicker({
  open,
  onOpenChange,
  value,
  onSelect,
  integrations,
  statuses,
  subOptions,
  subValue,
}: IntegrationPickerProps) {
  const [query, setQuery] = useState("");
  // When set, the picker shows its second pop-out: the variant choices for this
  // integration value (e.g. TrueNAS's per-metric tiles).
  const [subFor, setSubFor] = useState<string | null>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Reset the search box / sub-view and scroll the current choice into view
  // whenever the picker reopens, so the highlighted card is visible immediately.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSubFor(null);
    const id = requestAnimationFrame(() => {
      selectedRef.current?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const statusByService = useMemo(
    () => new Map((statuses ?? []).map((s) => [s.service, s])),
    [statuses],
  );

  const q = query.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);

  const noneOption: IntegrationOption = { value: NONE, label: "None" };
  const showNone = matches(noneOption.label);

  const groups = useMemo(() => {
    const filtered = integrations.filter((i) => matches(i.label));
    return groupByCategory(filtered, (i) => i.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrations, q]);

  const hasResults = showNone || groups.length > 0;

  function choose(next: string, subKey?: string) {
    onSelect(next, subKey);
    onOpenChange(false);
  }

  // Clicking a card either opens its variant pop-out (when it has sub-options)
  // or selects it immediately.
  function handleCardSelect(next: string) {
    if (subOptions?.[next]?.length) {
      setSubFor(next);
    } else {
      choose(next);
    }
  }

  const statusFor = (val: string): ServiceStatus | undefined => {
    const service = INTEGRATION_SERVICE[val];
    return service ? statusByService.get(service) : undefined;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 p-0">
        {subFor ? (
          <SubOptionView
            integrationValue={subFor}
            integrationLabel={
              integrations.find((i) => i.value === subFor)?.label ?? "Options"
            }
            options={subOptions?.[subFor] ?? []}
            selectedKey={value === subFor ? subValue : undefined}
            onBack={() => setSubFor(null)}
            onChoose={(key) => choose(subFor, key)}
          />
        ) : (
          <>
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>Choose an integration</DialogTitle>
              <DialogDescription>
                Attach a service to show its live status, or pick None for a
                plain app shortcut.
              </DialogDescription>
            </DialogHeader>

            <div className="px-6">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search integrations…"
                  className="pl-9"
                  aria-label="Search integrations"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
              {!hasResults && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No integrations match “{query}”.
                </p>
              )}

              {showNone && (
                <div className="mb-5">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <IntegrationCard
                      option={noneOption}
                      selected={value === NONE}
                      onSelect={handleCardSelect}
                      selectedRef={value === NONE ? selectedRef : undefined}
                    />
                  </div>
                </div>
              )}

              {groups.map((group) => (
                <div key={group.category} className="mb-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.category}
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {group.items.map((item) => (
                      <IntegrationCard
                        key={item.value}
                        option={item}
                        selected={value === item.value}
                        status={statusFor(item.value)}
                        onSelect={handleCardSelect}
                        selectedRef={value === item.value ? selectedRef : undefined}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// The picker's second pop-out: variant cards for a single integration (e.g.
// TrueNAS's per-metric tiles), with a back button to the full integration list.
function SubOptionView({
  integrationValue,
  integrationLabel,
  options,
  selectedKey,
  onBack,
  onChoose,
}: {
  integrationValue: string;
  integrationLabel: string;
  options: IntegrationSubOption[];
  selectedKey?: string;
  onBack: () => void;
  onChoose: (key: string) => void;
}) {
  const Icon = integrationMeta(integrationValue).icon;
  return (
    <>
      <DialogHeader className="px-6 pt-6">
        <button
          type="button"
          onClick={onBack}
          className="mb-1 -ml-1 flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4" />
          All integrations
        </button>
        <DialogTitle className="flex items-center gap-2">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            <Icon className="h-4 w-4" />
          </span>
          {integrationLabel} metrics
        </DialogTitle>
        <DialogDescription>
          Each metric gets its own dedicated live tile with a bespoke visual.
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map((opt) => {
            const selected = selectedKey === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                aria-pressed={selected}
                onClick={() => onChoose(opt.key)}
                className={cn(
                  "flex flex-col gap-0.5 rounded-md border p-3 text-left transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  selected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:border-primary/50 hover:bg-accent",
                )}
              >
                <span className="text-sm font-medium">{opt.label}</span>
                {opt.description && (
                  <span className="text-xs leading-snug text-muted-foreground">
                    {opt.description}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
