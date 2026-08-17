"use client";

import { CallResult, useMcpilot } from "@/lib/mcpilot-store";
import { ToolDef } from "@/lib/mcpilot-tools";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import {
  CheckCircle2,
  XCircle,
  Copy,
  Download,
  Clock,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

function looksLikeImage(content: string): { isImage: boolean; src?: string } {
  const c = content.trim();
  if (c.startsWith("data:image/")) return { isImage: true, src: c };
  // base64-only long blob without data: prefix — guess png
  if (/^[A-Za-z0-9+/=\s]{200,}$/.test(c) && c.length > 1000) {
    return { isImage: true, src: `data:image/png;base64,${c.replace(/\s/g, "")}` };
  }
  // JSON with image path
  return { isImage: false };
}

function prettyJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export function ResultView({ tool }: { tool: ToolDef | null }) {
  const result = useMcpilot((s) => s.lastResult);
  const calling = useMcpilot((s) => s.calling);

  if (calling) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">
          Calling <span className="font-mono">{tool?.name}</span> on MCPilot…
        </p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
        <p className="text-sm">No result yet.</p>
        <p className="text-xs">
          Pick a tool on the left, fill in parameters, and press{" "}
          <span className="font-mono">Run</span>.
        </p>
      </div>
    );
  }

  return <ResultBody result={result} tool={tool} />;
}

function ResultBody({
  result,
  tool,
}: {
  result: CallResult;
  tool: ToolDef | null;
}) {
  const wantsMarkdown = tool?.resultType === "markdown";
  const wantsImage = tool?.resultType === "image";

  const img = wantsImage ? looksLikeImage(result.content) : { isImage: false };

  const copyContent = () => {
    navigator.clipboard.writeText(result.content).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Copy failed"),
    );
  };

  const downloadContent = () => {
    const blob = new Blob([result.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.tool}-${result.at}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {/* status bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {result.isError ? (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" /> error
          </Badge>
        ) : (
          <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
            <CheckCircle2 className="h-3 w-3" /> ok
          </Badge>
        )}
        <Badge variant="outline" className="font-mono">
          {result.tool}
        </Badge>
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3 w-3" /> {result.durationMs} ms
        </Badge>
        <Badge variant="outline">HTTP {result.status}</Badge>
        <span className="ml-auto text-muted-foreground">
          {new Date(result.at).toLocaleTimeString()}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={copyContent}
        >
          <Copy className="mr-1 h-3 w-3" /> Copy
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={downloadContent}
        >
          <Download className="mr-1 h-3 w-3" /> Save
        </Button>
      </div>

      {/* args used */}
      {Object.keys(result.args).length > 0 && (
        <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Arguments sent ({Object.keys(result.args).length})
          </summary>
          <pre className="mt-2 max-h-32 overflow-auto font-mono text-[11px]">
            {prettyJson(result.args)}
          </pre>
        </details>
      )}

      {/* error banner */}
      {result.error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {result.error}
        </div>
      )}

      {/* body */}
      <Tabs defaultValue={pickDefaultTab(wantsMarkdown, img.isImage, result)} className="flex-1 min-h-0">
        <TabsList className="h-8">
          {img.isImage && <TabsTrigger value="image" className="text-xs">Image</TabsTrigger>}
          {wantsMarkdown && <TabsTrigger value="md" className="text-xs">Markdown</TabsTrigger>}
          <TabsTrigger value="raw" className="text-xs">Raw</TabsTrigger>
          {result.parsed !== null && (
            <TabsTrigger value="json" className="text-xs">JSON</TabsTrigger>
          )}
        </TabsList>

        {img.isImage && (
          <TabsContent value="image" className="mt-2 min-h-0 flex-1 overflow-auto">
            <div className="flex flex-col items-center gap-2 rounded-md border bg-background p-3">
              <img
                src={img.src}
                alt="MCPilot screenshot"
                className="max-h-[60vh] w-auto rounded border"
              />
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <ImageIcon className="h-3 w-3" />
                {result.content.length.toLocaleString()} chars of image data
              </p>
            </div>
          </TabsContent>
        )}

        {wantsMarkdown && (
          <TabsContent value="md" className="mt-2 min-h-0 flex-1">
            <ScrollArea className="h-full rounded-md border bg-background p-4">
              <article className="max-w-none text-sm leading-relaxed text-foreground
                [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold
                [&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold
                [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold
                [&_p]:my-2
                [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5
                [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5
                [&_li]:my-0.5
                [&_a]:text-emerald-400 [&_a]:underline
                [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_code]:font-mono
                [&_pre]:my-2 [&_pre]:rounded [&_pre]:bg-zinc-950 [&_pre]:p-3 [&_pre]:text-[11px]
                [&_pre_code]:bg-transparent [&_pre_code]:p-0
                [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-600 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground
                [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse
                [&_th]:border [&_th]:border-zinc-700 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left
                [&_td]:border [&_td]:border-zinc-700 [&_td]:px-2 [&_td]:py-1
                [&_hr]:my-3 [&_hr]:border-zinc-700">
                <ReactMarkdown>{result.content || "_(empty)_"}</ReactMarkdown>
              </article>
            </ScrollArea>
          </TabsContent>
        )}

        <TabsContent value="raw" className="mt-2 min-h-0 flex-1">
          <ScrollArea className="h-full rounded-md border bg-zinc-950 p-3">
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-zinc-200">
              {result.content || "(empty response)"}
            </pre>
          </ScrollArea>
        </TabsContent>

        {result.parsed !== null && (
          <TabsContent value="json" className="mt-2 min-h-0 flex-1">
            <ScrollArea className="h-full rounded-md border bg-zinc-950 p-3">
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-emerald-200">
                {prettyJson(result.parsed)}
              </pre>
            </ScrollArea>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function pickDefaultTab(
  wantsMarkdown: boolean,
  isImage: boolean,
  result: CallResult,
): string {
  if (isImage) return "image";
  if (wantsMarkdown) return "md";
  if (result.parsed !== null) return "json";
  return "raw";
}
