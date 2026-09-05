import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { COMPANY } from "@/lib/marketing/company";
import { Container } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Talk to sales",
  description: "Discuss your lead volume, branches and follow-up needs with ClientTurn.",
};

export default function ContactSalesPage() {
  return (
    <Container className="py-24 sm:py-32">
      <p className="font-mono text-xs tracking-widest text-content-accent">LET’S TALK ABOUT YOUR NEXT CHAPTER</p>
      <h1 className="mt-7 max-w-3xl text-5xl font-medium leading-none tracking-tight sm:text-7xl">More branches.<br />Bigger ambitions.</h1>
      <p className="mt-8 max-w-xl text-base leading-relaxed text-content-secondary">Tell us about your business, monthly lead volume and the way your team books work. We can discuss the right ClientTurn plan for your setup.</p>
      <a href={`mailto:${COMPANY.salesEmail}?subject=${encodeURIComponent("ClientTurn sales enquiry")}`} className="mt-10 inline-flex h-12 items-center gap-3 rounded-md bg-primary px-6 text-sm font-semibold text-on-primary hover:bg-primary-hover">Email the team <ArrowUpRight size={17} aria-hidden /></a>
      <p className="mt-4 text-sm text-content-muted">{COMPANY.salesEmail}</p>
      <Link href="/#pricing" className="mt-12 inline-block text-sm text-content-secondary underline underline-offset-4 hover:text-content">Compare self-serve plans</Link>
    </Container>
  );
}
