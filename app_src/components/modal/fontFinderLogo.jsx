import React from "react";

const FontFinderLogo = ({ size = 18, className = "" }) => (
  <svg
    className={`font-finder-logo${className ? ` ${className}` : ""}`}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M4.5 3.25h7.2l4.8 4.8v7.35a3.1 3.1 0 0 1-3.1 3.1H4.5a2.75 2.75 0 0 1-2.75-2.75V6A2.75 2.75 0 0 1 4.5 3.25Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M11.7 3.6v4.55h4.45" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path
      d="m6.9 14.35 2.75-7.1h1.25l2.75 7.1M7.85 11.8h4.85"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle className="font-finder-logo__lens" cx="16.45" cy="16.15" r="4.05" stroke="currentColor" strokeWidth="1.55" />
    <path d="m19.45 19.2 2.55 2.55" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

export default FontFinderLogo;
