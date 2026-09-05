import { Caveat } from "next/font/google";

/** Handwritten accent font, used only for the small decorative annotation
 * on each auth brand panel — never for UI copy. */
export const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  weight: ["600"],
});
