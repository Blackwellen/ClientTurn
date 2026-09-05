import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address")
  .max(254, "That email address is too long")
  .pipe(z.email("Enter a valid email address"));

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(72, "Use 72 characters or fewer")
  .refine((v) => /[A-Za-z]/.test(v), "Include at least one letter")
  .refine((v) => /[0-9]/.test(v), "Include at least one number");

const name = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter your ${label}`)
    .max(80, `${label[0].toUpperCase()}${label.slice(1)} is too long`);

export const attributionSchema = z.object({
  anonymousId: z.string().trim().max(64).optional(),
  utmSource: z.string().trim().max(200).optional(),
  utmMedium: z.string().trim().max(200).optional(),
  utmCampaign: z.string().trim().max(200).optional(),
  utmContent: z.string().trim().max(200).optional(),
  utmTerm: z.string().trim().max(200).optional(),
  referrer: z.string().trim().max(500).optional(),
  landingPath: z.string().trim().max(500).optional(),
});

export const signUpSchema = z.object({
  firstName: name("first name"),
  lastName: name("last name"),
  businessName: z
    .string()
    .trim()
    .min(2, "Enter your business name")
    .max(120, "Business name is too long"),
  email: emailSchema,
  password: passwordSchema,
  terms: z
    .string()
    .optional()
    .refine((v) => v === "on" || v === "true", "Accept the terms to continue"),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

export const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type AttributionInput = z.infer<typeof attributionSchema>;

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
};

/** Shared by the signup and reset forms so the meter never disagrees with Zod. */
export function scorePassword(value: string): PasswordStrength {
  if (!value) return { score: 0, label: "Enter a password" };

  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[A-Za-z]/.test(value) && /[0-9]/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value)))
    score++;

  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;
  const clamped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
  return { score: clamped, label: labels[clamped] };
}
