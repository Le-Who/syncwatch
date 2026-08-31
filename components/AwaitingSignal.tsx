import { Play, AlertCircle } from "lucide-react";
import { MediaComposer } from "./MediaComposer";

interface AwaitingSignalProps {
  canAddPlaylist: boolean;
  participantCount: number;
  sendCommand: (type: string, payload: any) => void;
}

export function AwaitingSignal({
  canAddPlaylist,
  participantCount,
  sendCommand,
}: AwaitingSignalProps) {
  return (
    <div className="font-theme relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-hidden bg-transparent p-4">
      <div className="theme-panel relative z-10 flex w-full max-w-lg flex-col items-center p-8">
        <div className="bg-theme-bg/50 border-theme-accent shadow-theme group-hover:shadow-theme-hover mb-8 flex h-24 w-24 items-center justify-center rounded-full border-2 transition-all">
          <Play className="text-theme-accent ml-2 h-12 w-12" />
        </div>
        <h2 className="text-theme-text mb-2 text-center text-3xl font-bold tracking-widest uppercase drop-shadow-sm">
          Awaiting Signal
        </h2>
        <p className="text-theme-muted mb-10 text-center text-sm tracking-wider uppercase opacity-80">
          System ready. Awaiting media input...
        </p>

        {canAddPlaylist || participantCount <= 1 ? (
          <MediaComposer
            sendCommand={sendCommand}
            canSubmit={true}
            autoFocus
            className="w-full"
          />
        ) : (
          <div className="bg-theme-bg/50 border-theme-danger text-theme-danger font-theme rounded-theme shadow-theme flex items-center gap-3 border-2 px-6 py-4 text-xs tracking-wider uppercase">
            <AlertCircle className="h-5 w-5" />
            <span>Restricted access. Command privileges required.</span>
          </div>
        )}
      </div>
    </div>
  );
}
