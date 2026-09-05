export const STORY_STAGES = [
  { title: "Speed to lead", headline: "Speed creates\nmomentum.", description: "Every new enquiry gets a fast first response.", side: "left", details: ["New enquiry", "Waiting", "Response sent"] },
  { title: "Follow-up engine", headline: "Consistent follow-up.\nMore replies.", description: "Keep the conversation moving. Stop when a lead replies.", side: "right", details: ["Immediately", "+10 min", "+2 hours", "+1 day", "+3 days", "Reply received", "Replied", "Booked", "Won", "Opted out", "Human takeover"] },
  { title: "Qualification", headline: "Deterministic qualification.\nBetter conversations.", description: "Your criteria decide which enquiries move forward.", side: "left", details: ["Service area", "Budget", "Timing", "Requirements", "Qualified", "Review", "Not a fit"] },
  { title: "Booking & handover", headline: "Automate booking.\nSeamless handover.", description: "Send qualified leads to your calendar or the right person.", side: "right", details: ["Qualified lead", "Booking", "Human handover", "Booking confirmed", "Needs attention", "Calendly", "Google Calendar"] },
  { title: "Lead reactivation", headline: "Re-engage the right\nconversations.", description: "Reconnect with eligible enquiries. Respect every suppression.", side: "left", details: ["No reply", "Not booked", "Older enquiry", "Opted out", "Already booked", "Active conversation", "Reply forwarded"] },
  { title: "Control & visibility", headline: "One system.\nTotal visibility.", description: "See every conversation, decision and next step in one place.", side: "left", details: ["Lead list", "Conversation", "Qualification", "Booking", "Needs attention", "Integration health", "Funnel / status"] },
] as const;
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const localProgress = (p: number, index: number) => clamp(p * 6 - index);
