import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Site-wide social preview image (link unfurls in Slack, iMessage, LinkedIn,
 * X, WhatsApp). Falls back for every route that does not define its own
 * opengraph-image/twitter-image — Next also uses this for the Twitter Card
 * image when a route has not set one explicitly.
 */
export const alt = "ClientTurn — Turn more leads into clients";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(join(process.cwd(), "public", "dark_background_logo.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0B1020",
          backgroundImage:
            "linear-gradient(135deg, #0B1020 0%, #0B1020 60%, #101830 100%)",
        }}
      >
        <img src={logoSrc} width={640} height={213} style={{ objectFit: "contain" }} />
        <div
          style={{
            marginTop: 40,
            fontSize: 32,
            color: "#E7FFC0",
            fontWeight: 600,
            letterSpacing: 0.5,
          }}
        >
          Turn more leads into clients
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 22,
            color: "#F7F9FC",
            opacity: 0.7,
          }}
        >
          Instant follow-up · Qualification · Booking
        </div>
      </div>
    ),
    { ...size }
  );
}
