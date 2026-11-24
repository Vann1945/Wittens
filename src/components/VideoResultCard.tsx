import { X } from 'lucide-react';
import { VideoShowcase, type VideoShowcaseData } from './VideoShowcase';

interface VideoResultCardProps {
  video: VideoShowcaseData;
  isLoadingStream?: boolean;
  streamError?: string | null;
  onStreamError?: () => void;
  onDismiss: () => void;
}

export function VideoResultCard({
  video,
  isLoadingStream = false,
  streamError = null,
  onStreamError,
  onDismiss,
}: VideoResultCardProps) {
  return (
    <section aria-label="Current view" className="mt-14 w-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <h2 className="text-[22px] font-bold tracking-[-0.02em] text-white">
            Current view
          </h2>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Remove current view"
          className="flex min-h-[38px] items-center gap-1.5 rounded-full border border-white/10 bg-[#141414] px-3.5 text-[13px] font-medium text-[#A1A1A6] hover:border-white/25 hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Remove</span>
        </button>
      </div>

      <VideoShowcase
        video={video}
        isLoadingStream={isLoadingStream}
        streamError={streamError}
        onStreamError={onStreamError}
      />
    </section>
  );
}
