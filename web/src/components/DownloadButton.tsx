import { DownloadTrayIcon } from './Icons';

interface DownloadButtonProps {
  isLoading: boolean;
}

export function DownloadButton({ isLoading }: DownloadButtonProps) {
  return (
    <button
      type="submit"
      disabled={isLoading}
      aria-busy={isLoading || undefined}
      className="flex min-h-[62px] w-full items-center justify-center gap-2.5 rounded-full bg-white px-5 py-3 text-[17.5px] font-semibold tracking-[-0.01em] text-[#0A0A0A] hover:bg-[#F2F2F4] active:bg-[#DCDCE0] disabled:cursor-wait disabled:bg-[#E5E5E8] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
    >
      {isLoading ? (
        <span className="inline-flex items-center gap-1 text-[13px] font-normal leading-none tracking-normal text-[#0A0A0A]">
          <span className="sr-only">Fetching video</span>
          <span aria-hidden="true" className="loading-dot" style={{ animationDelay: '0ms' }}>
            •
          </span>
          <span className="loading-dot" aria-hidden="true" style={{ animationDelay: '150ms' }}>
            •
          </span>
          <span className="loading-dot" aria-hidden="true" style={{ animationDelay: '300ms' }}>
            •
          </span>
        </span>
      ) : (
        <>
          <DownloadTrayIcon className="h-[22px] w-[22px] shrink-0" />
          <span>Download</span>
        </>
      )}
    </button>
  );
}
