export function Mascot() {
  return (
    <div className="flex items-center justify-center">
      <div
        aria-label="Mascot"
        className="flex h-[185px] w-[290px] sm:h-[205px] sm:w-[325px] items-center justify-center select-none"
      >
        <svg
          viewBox="0 0 240 140"
          className="h-full w-full"
          role="img"
          aria-label="Minimalist mascot face"
        >
          {/* Left forward-facing oval eye */}
          <ellipse cx="62" cy="68" rx="28" ry="36" fill="#FFFFFF" />

          {/* Centered cute U-smile */}
          <path
            d="M101 76 C106 100, 134 100, 139 76"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="15"
            strokeLinecap="round"
          />

          {/* Right forward-facing oval eye */}
          <ellipse cx="178" cy="68" rx="28" ry="36" fill="#FFFFFF" />
        </svg>
      </div>
    </div>
  );
}
