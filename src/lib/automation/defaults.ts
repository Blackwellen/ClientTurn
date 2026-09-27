/**
 * The default follow-up sequence every workspace starts with.
 *
 * Without a published sequence nothing is ever sent, so this is provisioned
 * during onboarding rather than left as an exercise. The cadence follows the
 * product bible: immediate, 10 minutes, 2 hours, 1 day, 3 days.
 *
 * Pure data — no server-only import — so the onboarding UI can preview it.
 */

export type DefaultStep = {
  position: number;
  delaySeconds: number;
  channel: "sms";
  template: string;
  label: string;
};

export const NEW_LEAD_SEQUENCE: DefaultStep[] = [
  {
    position: 0,
    delaySeconds: 0,
    channel: "sms",
    label: "Immediately",
    template:
      "Hi {{first_name}}, thanks for your enquiry with {{business_name}} about {{service_name}}. What prompted you to get in touch?",
  },
  {
    position: 1,
    delaySeconds: 10 * 60,
    channel: "sms",
    label: "10 minutes later",
    template:
      "Just checking you got my message about your {{service_name}} enquiry. Happy to answer any questions.",
  },
  {
    position: 2,
    delaySeconds: 2 * 60 * 60,
    channel: "sms",
    label: "2 hours later",
    template:
      "Hi {{first_name}}, still keen to help with your {{service_name}}. When would suit you for a quick chat?",
  },
  {
    position: 3,
    delaySeconds: 24 * 60 * 60,
    channel: "sms",
    label: "1 day later",
    template:
      "Morning {{first_name}}, {{business_name}} here. Would a short call this week help? I can send over a couple of times.",
  },
  {
    position: 4,
    delaySeconds: 3 * 24 * 60 * 60,
    channel: "sms",
    label: "3 days later",
    template:
      "Last one from me, {{first_name}}. If {{service_name}} is still on your list, just reply and I'll pick it up. {{business_phone}}",
  },
];

export const DEFAULT_AUTOMATIONS = [
  {
    type: "new_lead" as const,
    name: "New lead follow-up",
    steps: NEW_LEAD_SEQUENCE,
  },
];
