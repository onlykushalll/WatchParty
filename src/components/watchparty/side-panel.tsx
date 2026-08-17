"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChatPanel } from "@/components/watchparty/chat-panel";
import { QueuePanel } from "@/components/watchparty/queue-panel";
import { CallsPanel } from "@/components/watchparty/calls-panel";
import { ChatMessage, QueueItem, Participant } from "@/lib/sync/types";
import { MessageSquare, ListVideo, Video, Users } from "lucide-react";

export interface SidePanelProps {
  // Chat props
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  youColor: string;
  youId: string;
  youName: string;
  participants: Participant[];

  // Queue props
  queueItems: QueueItem[];
  currentQueueIndex: number;
  onQueueSelect: (i: number) => void;
  onQueueRemove: (i: number) => void;
  onQueueAdd?: (url: string, type?: string) => void;
  onQueueReorder?: (fromIndex: number, toIndex: number) => void;
  autoplayNext?: boolean;
  onToggleAutoplay?: (enabled: boolean) => void;

  // Calls props
  vmController?: string | null;
  onUpdateMediaState: (state: Partial<{
    isMicMuted: boolean;
    isCameraOn: boolean;
    cameraPrivacyMode: "blackout" | "blur" | "avatar";
  }>) => void;

  // Optional custom active tab
  defaultTab?: "chat" | "queue" | "calls";
  className?: string;
}

export function SidePanel({
  messages,
  onSendMessage,
  youColor,
  youId,
  youName,
  participants,
  queueItems,
  currentQueueIndex,
  onQueueSelect,
  onQueueRemove,
  onQueueAdd,
  onQueueReorder,
  autoplayNext,
  onToggleAutoplay,
  vmController,
  onUpdateMediaState,
  defaultTab = "chat",
  className = "",
}: SidePanelProps) {
  const [activeTab, setActiveTab] = useState<string>(defaultTab);

  const participantCount = participants.length;
  const activeCallCount = participants.filter((p) => p.isCameraOn || !p.isMicMuted).length;

  return (
    <div className={`flex h-full flex-col bg-card overflow-hidden ${className}`}>
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex h-full flex-col"
      >
        <div className="border-b px-2 py-1.5 shrink-0 bg-muted/30">
          <TabsList className="grid w-full grid-cols-3 h-8">
            <TabsTrigger value="chat" className="gap-1.5 text-xs">
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Chat</span>
              {messages.length > 0 && (
                <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.2 text-[9px] font-mono text-primary">
                  {messages.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="queue" className="gap-1.5 text-xs">
              <ListVideo className="h-3.5 w-3.5" />
              <span>Queue</span>
              {queueItems.length > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1.5 py-0.2 text-[9px] font-mono">
                  {queueItems.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="calls" className="gap-1.5 text-xs">
              <Video className="h-3.5 w-3.5" />
              <span>Calls</span>
              {activeCallCount > 0 && (
                <span className="ml-1 flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="chat" className="mt-0 min-h-0 flex-1">
          <ChatPanel
            messages={messages}
            onSend={onSendMessage}
            youColor={youColor}
            youId={youId}
            participantCount={participantCount}
          />
        </TabsContent>

        <TabsContent value="queue" className="mt-0 min-h-0 flex-1">
          <QueuePanel
            items={queueItems}
            currentIndex={currentQueueIndex}
            onSelect={onQueueSelect}
            onRemove={onQueueRemove}
            onAdd={onQueueAdd}
            onReorder={onQueueReorder}
            autoplayNext={autoplayNext}
            onToggleAutoplay={onToggleAutoplay}
          />
        </TabsContent>

        <TabsContent value="calls" className="mt-0 min-h-0 flex-1">
          <CallsPanel
            participants={participants}
            youId={youId}
            youName={youName}
            youColor={youColor}
            vmController={vmController}
            onUpdateMediaState={onUpdateMediaState}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
