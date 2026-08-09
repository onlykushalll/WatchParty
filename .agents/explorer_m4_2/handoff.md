# Milestone 4 Handoff Report: Participant List & Camera Privacy Exploration

## 1. Observation

### 1.1 Participant List Components
- **File**: `src/components/watchparty/participants-list.tsx`
  - Lines 11-40: `ParticipantsList` component renders horizontal compact pill elements displaying participant initials in a colored circle (`style={{ backgroundColor: p.color }}`), truncated name (max 80px), and optional host crown (`{p.isHost && <Crown className="h-3 w-3 text-amber-400" />}`).
  - Lines 42-74: `SyncIndicator` component displays RTT and Cristian's algorithm clock offset.
- **File**: `src/app/page.tsx`
  - Lines 566-605: Room Header navigation includes a participant counter and a hover dropdown showing online participants with avatars, names, and host crown icon (`{p.isHost && <Crown className="ml-auto h-3 w-3 text-amber-400" />}`).
- **Deficiencies Identified**:
  - **No Floor Controller Crown/Badge**: `vmController` state (identifying who holds Virtual Machine co-browsing control) exists in `useSyncEngine.ts` (line 83, 133, 290-307) and `sync-service/index.ts` (line 55, 481-521), but is NOT rendered anywhere in `ParticipantsList` or the header hover dropdown.
  - **No Mic / Camera Status Icons**: Neither `Participant` interface (`src/lib/sync/types.ts` line 14-20) nor UI components track or render microphone (`Mic` / `MicOff`) or camera (`Video` / `VideoOff`) status icons per participant.

### 1.2 Webcam & Camera Privacy Controls
- **File**: `src/app/page.tsx`
  - Lines 760-865: `SidePanel` component renders a `Calls` tab (lines 818-861) controlled by `camEnabled` local boolean state (`const [camEnabled, setCamEnabled] = useState(false)`).
  - Lines 819-840: Default state when camera is OFF (`!camEnabled`) shows a static empty card with heading *"Camera is Off"*, text *"Your privacy comes first. Click below if you wish to enable your webcam and mic."*, and an *"Enable Camera & Mic"* button.
  - Lines 842-859: Enabled state shows a static placeholder container with text *"Webcam Active (Opt-In)"* and a *"Turn Off Camera"* button.
- **Deficiencies Identified**:
  - **No Real WebRTC Media Stream / `getUserMedia` Integration**: No camera stream capture or local video rendering (`<video>` element with `navigator.mediaDevices.getUserMedia()`) is hooked up.
  - **No Camera Privacy Mute Modes**: No user selection for camera privacy state when camera is OFF or muted (e.g. **Blackout**, **CSS Blur backdrop**, or **Avatar / Initial Placeholder**).
  - **No Opt-in Participant Video Grid**: No grid component or video tiles for viewing remote room participants' webcam streams or privacy placeholders.

### 1.3 Shared Data Types & Socket Protocol
- **File**: `src/lib/sync/types.ts`
  - Lines 14-20: `Participant` interface:
    ```typescript
    export interface Participant {
      userId: string;
      name: string;
      color: string;
      isHost: boolean;
      joinedAt: number;
    }
    ```
  - Lacks properties for floor control indicator (`isFloorController`), mic state (`isMicMuted`), camera state (`isCameraOn`), and privacy mute mode (`cameraPrivacyMode`).
- **File**: `mini-services/sync-service/index.ts`
  - Lines 26-35 & 102-110: Server-side `Participant` struct lacks mic/camera status broadcasting to other room members via `presence:update`.

---

## 2. Logic Chain

1. **Host vs Floor Controller Distinction**:
   - *Observation*: Room host (`p.isHost`) is assigned to the first person entering the room. Separately, in Virtual PC co-browsing mode, `vmController` tracks who holds active keyboard/mouse control over the browser session via a floor control queue (`requestVmControl` / `releaseVmControl`).
   - *Reasoning*: Host crown (👑 amber-400) indicates room administrative authority, while floor controller badge/crown (e.g., 🎮 cyan badge or 🖱️ controller icon) indicates active interactive co-browsing permission. Showing both icons in `ParticipantsList` and header dropdowns gives users clear visual status of who is controlling the shared VM.

2. **Webcam Opt-In Privacy & Mute Representations**:
   - *Observation*: `Calls` tab in `page.tsx` line 818 uses a simple binary state (`camEnabled`), showing a mock placeholder card.
   - *Reasoning*: For production-grade privacy compliance (ORIGINAL_REQUEST R4: *"opt-in camera privacy"*), the webcam stream must default to strictly OFF (zero automatic video capture). Once opted in, users need explicit control over their privacy mute state when camera is toggled off or muted:
     - **Blackout**: Stream canvas muted to pitch black.
     - **Blur**: CSS backdrop blur on last captured frame / background.
     - **Avatar Placeholder**: Colored initials circle / avatar with pulsing waveform ring when speaking.

3. **Multi-Participant Video / Audio Grid & Status Sync**:
   - *Observation*: `useSyncEngine.ts` broadcasts presence updates when users join/leave, but does not relay audio/video mute states or camera privacy preferences.
   - *Reasoning*: Room members need to know when another participant turns their camera on/off or mutes their microphone. Syncing `isMicMuted`, `isCameraOn`, and `cameraPrivacyMode` via Socket.IO events (`media:state`) ensures participant lists, video grids, and chat overlays reflect accurate status indicators across all clients.

---

## 3. Caveats

- **WebRTC Peer Mesh vs Selective Forwarding Unit (SFU)**: WebRTC P2P mesh (direct peer connections) works well for small room sizes (2-6 participants). For larger rooms, WebRTC mesh requires higher bandwidth per client. For M4, client-side WebRTC / `getUserMedia` stream handling with fallback avatar placeholders per tile provides an optimal, lightweight solution.
- **Browser Media Permissions**: `navigator.mediaDevices.getUserMedia` requires HTTPS or `localhost` context. Browsers block audio auto-play without user interaction, supporting the requirement for explicit opt-in controls.

---

## 4. Conclusion

To fulfill Milestone 4 (R4) requirements for participant lists, crown badges, and camera privacy controls:

1. **Update Sync Data Types & Server Protocol**:
   - Extend `Participant` in `src/lib/sync/types.ts` and `mini-services/sync-service/index.ts` with `isMicMuted?: boolean`, `isCameraOn?: boolean`, and `cameraPrivacyMode?: 'blackout' | 'blur' | 'avatar'`.
   - Add `media:state` Socket.IO event handler to broadcast camera/mic status changes.

2. **Enhance `ParticipantsList` & Header Navigation**:
   - Add Host Crown (👑 `amber-400`) and VM Floor Controller Badge (🎮 / 🖱️ `cyan-400`).
   - Add Mic Muted (`MicOff` / red) and Camera Active (`Video` / emerald) icon indicators next to participant names.
   - Upgrade `ParticipantsList` component into an expandable side-panel drawer and compact bar.

3. **Create Dedicated Camera Privacy & Calls Component (`src/components/watchparty/calls-panel.tsx`)**:
   - Implement real local `getUserMedia` video & audio stream capture on explicit user opt-in.
   - Add mic mute/unmute toggle button.
   - Implement **Camera Privacy Mute Mode** selector:
     - **Blackout**: Black screen tile.
     - **Blur**: CSS backdrop-blur filter on video canvas.
     - **Avatar**: Animated initial avatar placeholder with audio reactivity ring.
   - Implement **Opt-in Participant Stream Grid**: Display video tiles for participants in the call with participant status overlays.

---

## 5. Verification Method

1. **Build & Typecheck Verification**:
   - Execute `bun run build` to confirm zero TypeScript compilation errors and zero ESLint errors across Next.js and mini-services.
2. **Component Inspection & Manual Verification**:
   - Verify `src/components/watchparty/participants-list.tsx` renders host crowns (👑), floor controller badges (🎮), and mic/camera status icons.
   - Verify `Calls` panel component handles camera opt-in button, `getUserMedia` video preview, privacy mode selection (Blackout / Blur / Avatar), and remote participant video tiles.
3. **Invalidation Conditions**:
   - If camera defaults to ON without user consent (violates zero-camera opt-in privacy rule).
   - If floor controller crown/badge is missing when a user takes VM control.
   - If `bun run build` fails with type or lint errors.
