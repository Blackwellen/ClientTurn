"use server";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getSupportMessages() {
 const w = await requireWorkspace(); const db = createAdminClient();
 const { data, error } = await db.from("support_tickets").select("id, reference, subject, status, created_at, support_messages(id, direction, body, created_at)").eq("business_id", w.businessId).eq("created_by_user_id",w.userId).order("created_at",{ascending:false}).limit(20);
 if(error) throw new Error("Support messages could not be loaded.");
 return data ?? [];
}
export async function sendSupportMessage(input: unknown) {
 const parsed = z.object({ body: z.string().trim().min(5).max(5000), ticketId: z.uuid().optional() }).safeParse(input);
 if(!parsed.success) return { error: "Write a message between 5 and 5,000 characters." };
 const w = await requireWorkspace(); const db = createAdminClient();
 const { count } = await db.from("support_messages").select("id",{count:"exact",head:true}).eq("author_user_id",w.userId).gte("created_at",new Date(Date.now()-60000).toISOString());
 if((count ?? 0) >= 5) return { error: "Please wait a minute before sending another message." };
 let id = parsed.data.ticketId;
 let created = false;
 if(id) { const { data } = await db.from("support_tickets").select("id").eq("id",id).eq("business_id",w.businessId).eq("created_by_user_id",w.userId).maybeSingle(); if(!data) return { error:"Conversation not found." }; }
 else { const { data, error } = await db.from("support_tickets").insert({ business_id:w.businessId, created_by_user_id:w.userId, subject:parsed.data.body.slice(0,100), source:"APP" }).select("id").single(); if(error) return {error:"Your message could not be saved. Please retry."}; id=data.id; created=true; }
 const { error } = await db.from("support_messages").insert({ business_id:w.businessId, ticket_id:id, author_user_id:w.userId, direction:"INBOUND", body:parsed.data.body, channel:"APP" });
 if(error) { if(created) await db.from("support_tickets").delete().eq("id",id).eq("business_id",w.businessId); return {error:"Your message could not be saved. Please retry."}; }
 await db.from("support_tickets").update({status:"OPEN",last_customer_message_at:new Date().toISOString()}).eq("id",id).eq("business_id",w.businessId);
 return {ok:true};
}
