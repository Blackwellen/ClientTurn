"use server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { sealSecret } from "@/lib/security/secret-box";
import { INSTALLABLE_APPS } from "./apps";
export async function listAppInstalls(){const w=await requireRole("admin");const db=createAdminClient();const {data,error}=await db.from("workspace_app_installs").select("id,app_key,active,last_received_at").eq("business_id",w.businessId);if(error)throw new Error("Could not load installed apps.");return data??[];}
export async function installWorkspaceApp(input:unknown){
 const p=z.object({app:z.string(),secret:z.string().min(32).max(200)}).safeParse(input);if(!p.success||!INSTALLABLE_APPS.some(a=>a.id===p.data.app))return {error:"Choose an app and a signing secret of at least 32 characters."};
 const w=await requireRole("admin");const db=createAdminClient();
 let secret:string;try{secret=sealSecret(p.data.secret);}catch{return {error:"Credential encryption must be configured before installing apps."};}
 const {data,error}=await db.from("workspace_app_installs").upsert({business_id:w.businessId,app_key:p.data.app,secret_ciphertext:secret,installed_by:w.userId,active:true},{onConflict:"business_id,app_key"}).select("id").single();
 return error?{error:"App installation failed. Please retry."}:{id:data.id};
}
export async function uninstallWorkspaceApp(id:unknown){const p=z.uuid().safeParse(id);if(!p.success)return {error:"Invalid installation."};const w=await requireRole("admin");const {error}=await createAdminClient().from("workspace_app_installs").update({active:false}).eq("id",p.data).eq("business_id",w.businessId);return error?{error:"Could not uninstall app."}:{ok:true};}
