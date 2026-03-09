import { Play, AlertCircle } from "lucide-react";
import { MediaApiService } from "@/lib/MediaApiService";

interface AwaitingSignalProps {
  canEditPlaylist: boolean;
  participantCount: number;
  sendCommand: (type: string, payload: any) => void;
}

export function AwaitingSignal({
  canEditPlaylist,
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

        {canEditPlaylist || participantCount <= 1 ? (
          <form
            className="relative w-full"
            onSubmit={async (e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem(
                "urlInput",
              ) as HTMLInputElement;
              const url = input.value.trim();
              const btn = e.currentTarget.querySelector("button");
              if (btn) btn.disabled = true;

              if (url) {
                const mediaInfo = await MediaApiService.fetchMediaInfo(url);
                sendCommand("add_item", mediaInfo);
                input.value = "";
              }
              if (btn) btn.disabled = false;
            }}
          >
            <div className="bg-theme-bg/50 border-theme-border/50 rounded-theme focus-within:border-theme-accent shadow-theme focus-within:shadow-theme-hover relative flex flex-col items-stretch overflow-hidden border-2 transition-all sm:flex-row">
              <input
                name="urlInput"
                type="url"
                placeholder="Paste video stream URL..."
                className="text-theme-text placeholder-theme-muted font-theme flex-1 bg-transparent px-5 py-4 text-sm focus:outline-none"
                required
              />
              <button
                type="submit"
                className="bg-theme-accent text-theme-bg border-theme-border/30 px-8 py-4 font-bold tracking-wider uppercase transition-all hover:brightness-110 hover:filter disabled:cursor-not-allowed disabled:opacity-50 sm:border-l-2"
              >
                Init
              </button>
            </div>
          </form>
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
