export type Point3 = [number, number, number];

export const STAGES = [
  { title: "New Lead", short: "Lead", start: 0.16, position: [-2.15, 3.6, -1.8] as Point3, label: [0.25, 4.15, 0.4] as Point3, description: "A new enquiry arrives from your Facebook or Instagram lead form." },
  { title: "Message Sent", short: "Message", start: 0.32, position: [0.7, 2.15, -0.6] as Point3, label: [2.05, 2.2, 0.5] as Point3, description: "Your configured first message starts the conversation. Follow-up respects quiet hours and stops on reply or opt-out." },
  { title: "Qualified", short: "Qualified", start: 0.48, position: [-0.8, -0.05, 0.4] as Point3, label: [1.5, 0.1, 0.5] as Point3, description: "Budget, authority, need and timeline: your questions, your criteria. Unclear answers go to your team." },
  { title: "Booking Confirmed", short: "Booked", start: 0.64, position: [1.15, -3.15, 1.85] as Point3, label: [1.55, -2.65, 0.9] as Point3, description: "Qualified enquiries reach your booking calendar, with the conversation and answers already attached." },
  { title: "Client Won", short: "Won", start: 0.8, position: [-1.1, -5.2, 2] as Point3, label: [1.65, -4.05, 0.5] as Point3, description: "Record the won job and trace the outcome back to its campaign. £8,420 is an illustrative pipeline value, not a customer result." },
] as const;

export const PALETTE = {
  background: "#050814", shell: "#101728", inset: "#080e1a", edge: "#4c586d",
  lime: "#B7F34A", soft: "#DFFF87", white: "#F8FAFC", muted: "#8E98AA",
} as const;

export function smoothRange(value: number, start: number, end: number) {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function activeStageAt(progress: number) {
  return progress < 0.16 ? -1 : Math.min(4, Math.floor((progress - 0.16 + 0.000001) / 0.16));
}

export function activationAt(progress: number, index: number) {
  return smoothRange(progress, STAGES[index].start - 0.035, STAGES[index].start + 0.08);
}
