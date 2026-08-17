"use client";

import { useState } from "react";
import { ToolDef, ToolParam } from "@/lib/mcpilot-tools";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, RotateCcw, AlertTriangle } from "lucide-react";
import { useMcpilot } from "@/lib/mcpilot-store";

function defaultFor(p: ToolParam): unknown {
  if (p.default !== undefined) return p.default;
  if (p.type === "boolean") return false;
  return "";
}

export function ToolForm({ tool }: { tool: ToolDef }) {
  const callTool = useMcpilot((s) => s.callTool);
  const calling = useMcpilot((s) => s.calling);

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const p of tool.params) init[p.name] = defaultFor(p);
    return init;
  });

  // NOTE: parent remounts this component via `key={tool.name}`, so a fresh
  // initial state is created automatically when the selected tool changes.

  const setVal = (name: string, v: unknown) =>
    setValues((s) => ({ ...s, [name]: v }));

  const reset = () => {
    const init: Record<string, unknown> = {};
    for (const p of tool.params) init[p.name] = defaultFor(p);
    setValues(init);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const p of tool.params) {
      const v = values[p.name];
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      payload[p.name] = v;
    }
    void callTool(tool.name, payload);
  };

  const accent =
    tool.category === "admin"
      ? "text-rose-400"
      : tool.category === "web"
        ? "text-emerald-400"
        : tool.category === "file"
          ? "text-amber-400"
          : tool.category === "terminal"
            ? "text-violet-400"
            : tool.category === "system"
              ? "text-fuchsia-400"
              : "text-slate-300";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className={`font-mono text-lg font-semibold ${accent}`}>
              {tool.name}
            </h2>
            {tool.dangerous && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> dangerous
              </Badge>
            )}
            {tool.params.length === 0 && (
              <Badge variant="secondary">no params</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {tool.description}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={calling}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
          </Button>
          <Button type="submit" size="sm" disabled={calling}>
            {calling ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1 h-3.5 w-3.5" />
            )}
            Run
          </Button>
        </div>
      </div>

      {tool.params.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
          This tool takes no parameters. Press <span className="font-mono">Run</span> to execute.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {tool.params.map((p) => (
            <ParamInput
              key={p.name}
              param={p}
              value={values[p.name]}
              onChange={(v) => setVal(p.name, v)}
            />
          ))}
        </div>
      )}
    </form>
  );
}

function ParamInput({
  param,
  value,
  onChange,
}: {
  param: ToolParam;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const full = param.type === "text" || param.type === "string[]";

  return (
    <div className={full ? "sm:col-span-2 flex flex-col gap-1.5" : "flex flex-col gap-1.5"}>
      <Label htmlFor={param.name} className="flex items-center gap-1 text-xs">
        <span className="font-mono">{param.name}</span>
        {param.required && <span className="text-rose-400">*</span>}
        <span className="text-muted-foreground">— {param.label}</span>
      </Label>

      {param.type === "boolean" ? (
        <div className="flex items-center gap-2 pt-1">
          <Switch
            id={param.name}
            checked={value === true || value === "true"}
            onCheckedChange={(c) => onChange(c)}
          />
          <span className="text-xs text-muted-foreground">
            {value === true || value === "true" ? "true" : "false"}
          </span>
        </div>
      ) : param.type === "enum" ? (
        <Select
          value={String(value ?? "")}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger id={param.name}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {(param.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : param.type === "number" ? (
        <Input
          id={param.name}
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          placeholder={param.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Textarea
          id={param.name}
          rows={param.type === "text" || param.type === "string[]" ? 4 : 1}
          value={String(value ?? "")}
          placeholder={param.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="resize-y font-mono text-xs"
        />
      )}

      {param.help && (
        <p className="text-[11px] text-muted-foreground">{param.help}</p>
      )}
    </div>
  );
}
