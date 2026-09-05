"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { motion, useInView } from "motion/react";
import { CtaLink } from "./cta";

/**
 * The end of the journey. The master rail re-enters from the background one last time and resolves
 * into the brand mark, then the page settles to black for the footer.
 */
export function FinalCta() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  return (
    <section ref={ref} className="ct-final">
      <svg className="ct-final-rail" viewBox="0 0 1200 460" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="ct-final-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#B7F34A" stopOpacity="0" />
            <stop offset="42%" stopColor="#B7F34A" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#B7F34A" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <motion.path
          d="M -40 442 C 200 450 380 432 560 400 C 700 374 806 262 874 196"
          fill="none" stroke="url(#ct-final-line)" strokeWidth={3.5} strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={inView ? { pathLength: 1 } : undefined}
          transition={{ duration: 1.5, ease: [0.22, 0.61, 0.36, 1] }}
        />
      </svg>
      <div className="ct-final-inner">
        <div>
          <p className="ct-section-eyebrow">Your next chapter starts here</p>
          <h2>Turn more enquiries<br />into clients.</h2>
          <p className="ct-final-sub">Connect your lead source, configure your follow-up and start moving enquiries toward booking.</p>
          <div className="ct-final-actions">
            <CtaLink placement="final_cta" size="lg">Start Free <ArrowUpRight size={17} aria-hidden /></CtaLink>
            <Link href="#how-it-works" className="ct-text-link">See how it works <ArrowUpRight size={15} aria-hidden /></Link>
            <Link href="/contact-sales" className="ct-final-sales">Talk to sales</Link>
          </div>
        </div>
        <motion.div
          className="ct-final-mark" aria-hidden
          initial={{ opacity: 0, scale: 0.9 }} animate={inView ? { opacity: 1, scale: 1 } : undefined}
          transition={{ duration: 0.7, delay: 1.05, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <Image src="/Favicon.png" alt="" width={188} height={188} priority={false} />
        </motion.div>
      </div>
    </section>
  );
}
