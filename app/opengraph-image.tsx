import { ImageResponse } from "next/og";

export const alt = "BetterLeaf - A modern LaTeX editor for academic writing";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, hsl(174, 62%, 28%) 0%, hsl(174, 62%, 40%) 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="80"
          height="80"
          viewBox="0 0 32 32"
          fill="none"
          style={{ marginBottom: 24 }}
        >
          <path
            d="M16 6C12 6 8 10 8 16c0 4 2 7 4 9"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M12 25c2-2 4-5 4-9 0-6 4-8 8-10-2 6-4 10-4 14 0 2-1 4-2 5"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M10 18c2-1 5-2 8-2"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.7"
          />
          <path
            d="M11 22c2-1 4-3 6-4"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.7"
          />
        </svg>
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: "white",
            marginBottom: 16,
          }}
        >
          BetterLeaf
        </div>
        <div
          style={{
            fontSize: 28,
            color: "rgba(255, 255, 255, 0.85)",
          }}
        >
          A modern LaTeX editor for academic writing
        </div>
      </div>
    ),
    { ...size }
  );
}
