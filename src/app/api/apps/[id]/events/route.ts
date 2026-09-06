import { createHmac,timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { openSecret } from "@/lib/security/secret-box";
import { rateLimitResponse } from "@/lib/security/rate-limit";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const limited=await rateLimitResponse("webhook:inbound",request.headers);if(limited)return limited;
 const {id}=await params;if(!z.uuid().safeParse(id).success)return Response.json({error:"Invalid installation"},{status:400});
 const db=createAdminClient();const {data}=await db.from("workspace_app_installs").select("secret_ciphertext").eq("id",id).eq("active",true).maybeSingle();const secret=openSecret(data?.secret_ciphertext);
 if(!secret)return Response.json({error:"Installation unavailable"},{status:401});
 const timestamp=request.headers.get("x-clientturn-timestamp")??"";const signature=request.headers.get("x-clientturn-signature")??"";
 if(!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300)return Response.json({error:"Expired timestamp"},{status:401});
 if(Number(request.headers.get("content-length")??0)>16384)return Response.json({error:"Payload too large"},{status:413});
 const raw=await request.text();if(Buffer.byteLength(raw)>16384)return Response.json({error:"Payload too large"},{status:413});
 const expected=createHmac("sha256",secret).update(`${timestamp}.${raw}`).digest("hex");
 if(!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return Response.json({error:"Invalid signature"},{status:401});
 let value:unknown;try{value=JSON.parse(raw);}catch{return Response.json({error:"Invalid JSON"},{status:400});}
 const p=z.object({eventId:z.string().min(1).max(150),firstName:z.string().max(100).optional(),lastName:z.string().max(100).optional(),email:z.email().max(254).optional(),phone:z.string().regex(/^\+[1-9]\d{6,14}$/).optional()}).refine(v=>!!v.email||!!v.phone).safeParse(value);
 if(!p.success)return Response.json({error:"Provide eventId and a valid email or E.164 phone."},{status:400});
 const {error}=await db.rpc("receive_workspace_app_event",{p_install_id:id,p_event_id:p.data.eventId,p_payload:p.data});
 if(error)return Response.json({error:"Event could not be queued"},{status:503});
 return Response.json({accepted:true},{status:202});
}
