import { z } from "zod";

export const farmerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  barangay: z.string().trim().optional().or(z.literal("")),
  mobile: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().optional().or(z.literal("")),
});
export type FarmerInput = z.infer<typeof farmerSchema>;

export const priceSchema = z.object({
  effective_date: z.string().min(1),
  grade_id: z.string().uuid().optional().or(z.literal("")),
  price_per_kg: z.coerce.number().min(0, "Price must be 0 or more"),
  buyer_price_per_kg: z.coerce.number().min(0).optional(),
});

export const advanceSchema = z.object({
  farmer_id: z.string().uuid(),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  remarks: z.string().trim().optional().or(z.literal("")),
});

export const repaymentSchema = z.object({
  farmer_id: z.string().uuid(),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  remarks: z.string().trim().optional().or(z.literal("")),
});

export const settingsSchema = z.object({
  shrinkage_threshold_pct: z.coerce.number().min(0).max(100),
  advance_approval_limit: z.coerce.number().min(0),
});

export const voidSchema = z.object({
  purchase_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required"),
});
