"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendManualMessage } from "@/lib/leads/actions";

export async function inboxAction(input: unknown) {
 const parsed=z.object({id:z.uuid(),action:z.enum(["read","archive","restore","reply"]),body:z.string().trim().max(1200).optional()}).safeParse(input);
 if(!parsed.success)return {error:"Invalid conversation action."};
 const w=await requireRole("member"); const db=createAdminClient();
 const {data:c}=await db.from("conversations").select("id, lead_id, channel").eq("id",parsed.data.id).eq("business_id",w.businessId).maybeSingle();
 if(!c)return {error:"Conversation not found."};
 if(parsed.data.action==="reply") {
  if(!c.lead_id || !["sms","whatsapp"].includes(c.channel))return {error:"Reply sending for this channel is not configured. Open the original provider to reply."};
  const result=await sendManualMessage({leadId:c.lead_id,channel:c.channel,body:parsed.data.body??""});
  if(!result.ok)return {error:result.error};
 } else {
  const patch=parsed.data.action==="read"?{unread_count:0}:{is_archived:parsed.data.action==="archive"};
  const {error}=await db.from("conversations").update(patch).eq("id",c.id).eq("business_id",w.businessId);
  if(error)return {error:"The conversation could not be updated."};
 }
 revalidatePath("/app/inbox");return {ok:true};
}
