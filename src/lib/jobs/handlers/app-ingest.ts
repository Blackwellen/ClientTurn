import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClaimedJob } from "@/lib/jobs/queue";
export async function handleAppIngest(job:ClaimedJob){const id=z.uuid().parse(job.payload.eventId);const businessId=z.uuid().parse(job.business_id);const {error}=await createAdminClient().rpc("process_workspace_app_event",{p_event_id:id,p_business_id:businessId});if(error)throw error;}
