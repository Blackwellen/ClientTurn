export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_prompt_versions: {
        Row: {
          created_at: string
          id: string
          prompt_key: string
          schema_version: number
          status: string
          system_prompt: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          prompt_key: string
          schema_version?: number
          status?: string
          system_prompt: string
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          prompt_key?: string
          schema_version?: number
          status?: string
          system_prompt?: string
          version?: number
        }
        Relationships: []
      }
      ai_runs: {
        Row: {
          automation_run_id: string | null
          business_id: string
          cached_input_tokens: number
          confidence: number | null
          conversation_id: string | null
          created_at: string
          deployment: string
          error_code: string | null
          estimated_cost_usd: number
          id: string
          input_tokens: number
          latency_ms: number | null
          lead_id: string | null
          output_tokens: number
          prompt_key: string | null
          prompt_version: number | null
          result_json: Json | null
          status: string
          task_type: string
        }
        Insert: {
          automation_run_id?: string | null
          business_id: string
          cached_input_tokens?: number
          confidence?: number | null
          conversation_id?: string | null
          created_at?: string
          deployment: string
          error_code?: string | null
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          lead_id?: string | null
          output_tokens?: number
          prompt_key?: string | null
          prompt_version?: number | null
          result_json?: Json | null
          status?: string
          task_type: string
        }
        Update: {
          automation_run_id?: string | null
          business_id?: string
          cached_input_tokens?: number
          confidence?: number | null
          conversation_id?: string | null
          created_at?: string
          deployment?: string
          error_code?: string | null
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          lead_id?: string | null
          output_tokens?: number
          prompt_key?: string | null
          prompt_version?: number | null
          result_json?: Json | null
          status?: string
          task_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_runs_automation_run_id_fkey"
            columns: ["automation_run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          business_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          metadata: Json
        }
        Insert: {
          action: string
          actor_type?: string
          actor_user_id?: string | null
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_definitions: {
        Row: {
          business_id: string
          created_at: string
          enabled: boolean
          id: string
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          type: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_definitions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_events: {
        Row: {
          automation_run_id: string | null
          business_id: string
          event_type: string
          id: string
          lead_id: string | null
          occurred_at: string
          payload: Json
        }
        Insert: {
          automation_run_id?: string | null
          business_id: string
          event_type: string
          id?: string
          lead_id?: string | null
          occurred_at?: string
          payload?: Json
        }
        Update: {
          automation_run_id?: string | null
          business_id?: string
          event_type?: string
          id?: string
          lead_id?: string | null
          occurred_at?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "automation_events_automation_run_id_fkey"
            columns: ["automation_run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          business_id: string
          created_at: string
          current_step: number
          id: string
          lead_id: string
          next_run_at: string | null
          state: string
          stopped_at: string | null
          stopped_reason: string | null
          updated_at: string
          version_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          current_step?: number
          id?: string
          lead_id: string
          next_run_at?: string | null
          state?: string
          stopped_at?: string | null
          stopped_reason?: string | null
          updated_at?: string
          version_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          current_step?: number
          id?: string
          lead_id?: string
          next_run_at?: string | null
          state?: string
          stopped_at?: string | null
          stopped_reason?: string | null
          updated_at?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "automation_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_steps: {
        Row: {
          business_id: string
          channel: string
          created_at: string
          delay_seconds: number
          enabled: boolean
          id: string
          position: number
          template: string
          updated_at: string
          version_id: string
        }
        Insert: {
          business_id: string
          channel: string
          created_at?: string
          delay_seconds?: number
          enabled?: boolean
          id?: string
          position: number
          template: string
          updated_at?: string
          version_id: string
        }
        Update: {
          business_id?: string
          channel?: string
          created_at?: string
          delay_seconds?: number
          enabled?: boolean
          id?: string
          position?: number
          template?: string
          updated_at?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_steps_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_steps_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "automation_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_versions: {
        Row: {
          automation_id: string
          business_id: string
          created_at: string
          id: string
          published_at: string | null
          published_by: string | null
          status: string
          updated_at: string
          version_number: number
        }
        Insert: {
          automation_id: string
          business_id: string
          created_at?: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          version_number?: number
        }
        Update: {
          automation_id?: string
          business_id?: string
          created_at?: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "automation_versions_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automation_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_versions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          assigned_user_id: string | null
          booking_url: string | null
          business_id: string
          cancel_url: string | null
          created_at: string
          ends_at: string | null
          external_event_id: string | null
          id: string
          lead_id: string
          location: string | null
          notes: string | null
          provider: string
          reschedule_url: string | null
          service_id: string | null
          starts_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_user_id?: string | null
          booking_url?: string | null
          business_id: string
          cancel_url?: string | null
          created_at?: string
          ends_at?: string | null
          external_event_id?: string | null
          id?: string
          lead_id: string
          location?: string | null
          notes?: string | null
          provider?: string
          reschedule_url?: string | null
          service_id?: string | null
          starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string | null
          booking_url?: string | null
          business_id?: string
          cancel_url?: string | null
          created_at?: string
          ends_at?: string | null
          external_event_id?: string | null
          id?: string
          lead_id?: string
          location?: string | null
          notes?: string | null
          provider?: string
          reschedule_url?: string | null
          service_id?: string | null
          starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      business_ai_settings: {
        Row: {
          allow_ai_interpretation: boolean
          allow_ai_reply: boolean
          business_description: string | null
          business_id: string
          created_at: string
          fallback_message: string | null
          handover_instruction: string | null
          id: string
          reply_length: string
          tone: string
          updated_at: string
        }
        Insert: {
          allow_ai_interpretation?: boolean
          allow_ai_reply?: boolean
          business_description?: string | null
          business_id: string
          created_at?: string
          fallback_message?: string | null
          handover_instruction?: string | null
          id?: string
          reply_length?: string
          tone?: string
          updated_at?: string
        }
        Update: {
          allow_ai_interpretation?: boolean
          allow_ai_reply?: boolean
          business_description?: string | null
          business_id?: string
          created_at?: string
          fallback_message?: string | null
          handover_instruction?: string | null
          id?: string
          reply_length?: string
          tone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_ai_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_cost_daily: {
        Row: {
          ai_cost: number
          business_id: string
          date: string
          email_cost: number
          infrastructure_allocated_cost: number
          other_cost: number
          sms_cost: number
          stripe_cost: number
          total_cost: number
          updated_at: string
          whatsapp_cost: number
        }
        Insert: {
          ai_cost?: number
          business_id: string
          date: string
          email_cost?: number
          infrastructure_allocated_cost?: number
          other_cost?: number
          sms_cost?: number
          stripe_cost?: number
          total_cost?: number
          updated_at?: string
          whatsapp_cost?: number
        }
        Update: {
          ai_cost?: number
          business_id?: string
          date?: string
          email_cost?: number
          infrastructure_allocated_cost?: number
          other_cost?: number
          sms_cost?: number
          stripe_cost?: number
          total_cost?: number
          updated_at?: string
          whatsapp_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_cost_daily_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_margin_monthly: {
        Row: {
          ai_cost: number
          allocated_platform_cost: number
          billing_period: string
          business_id: string
          gross_contribution: number
          gross_margin_percent: number | null
          overage_revenue: number
          sms_cost: number
          stripe_cost: number
          subscription_revenue: number
          total_cogs: number
          total_revenue: number
          updated_at: string
          whatsapp_cost: number
        }
        Insert: {
          ai_cost?: number
          allocated_platform_cost?: number
          billing_period: string
          business_id: string
          gross_contribution?: number
          gross_margin_percent?: number | null
          overage_revenue?: number
          sms_cost?: number
          stripe_cost?: number
          subscription_revenue?: number
          total_cogs?: number
          total_revenue?: number
          updated_at?: string
          whatsapp_cost?: number
        }
        Update: {
          ai_cost?: number
          allocated_platform_cost?: number
          billing_period?: string
          business_id?: string
          gross_contribution?: number
          gross_margin_percent?: number | null
          overage_revenue?: number
          sms_cost?: number
          stripe_cost?: number
          subscription_revenue?: number
          total_cogs?: number
          total_revenue?: number
          updated_at?: string
          whatsapp_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_margin_monthly_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_members: {
        Row: {
          accepted_at: string | null
          business_id: string
          created_at: string
          id: string
          invited_at: string | null
          invited_email: string | null
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          business_id: string
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_email?: string | null
          role?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          business_id?: string
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_email?: string | null
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_settings: {
        Row: {
          ai_assist_enabled: boolean
          allowed_postcode_prefixes: string[]
          appointment_duration_minutes: number
          blocked_postcode_prefixes: string[]
          booking_buffer_minutes: number
          booking_mode: string
          booking_url: string | null
          business_hours: Json
          business_id: string
          created_at: string
          default_channel: string
          fallback_channel: string | null
          message_signature: string | null
          notify_booking: boolean
          notify_campaign_complete: boolean
          notify_daily_summary: boolean
          notify_handover: boolean
          notify_integration_failure: boolean
          opt_out_wording: string
          quiet_hours_enabled: boolean
          quiet_hours_end: string
          quiet_hours_start: string
          service_area_description: string | null
          updated_at: string
        }
        Insert: {
          ai_assist_enabled?: boolean
          allowed_postcode_prefixes?: string[]
          appointment_duration_minutes?: number
          blocked_postcode_prefixes?: string[]
          booking_buffer_minutes?: number
          booking_mode?: string
          booking_url?: string | null
          business_hours?: Json
          business_id: string
          created_at?: string
          default_channel?: string
          fallback_channel?: string | null
          message_signature?: string | null
          notify_booking?: boolean
          notify_campaign_complete?: boolean
          notify_daily_summary?: boolean
          notify_handover?: boolean
          notify_integration_failure?: boolean
          opt_out_wording?: string
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string
          quiet_hours_start?: string
          service_area_description?: string | null
          updated_at?: string
        }
        Update: {
          ai_assist_enabled?: boolean
          allowed_postcode_prefixes?: string[]
          appointment_duration_minutes?: number
          blocked_postcode_prefixes?: string[]
          booking_buffer_minutes?: number
          booking_mode?: string
          booking_url?: string | null
          business_hours?: Json
          business_id?: string
          created_at?: string
          default_channel?: string
          fallback_channel?: string | null
          message_signature?: string | null
          notify_booking?: boolean
          notify_campaign_complete?: boolean
          notify_daily_summary?: boolean
          notify_handover?: boolean
          notify_integration_failure?: boolean
          opt_out_wording?: string
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string
          quiet_hours_start?: string
          service_area_description?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          activated_at: string | null
          created_at: string
          created_by: string | null
          id: string
          industry: string | null
          logo_key: string | null
          name: string
          onboarding_state: Json
          onboarding_step: string
          phone: string | null
          slug: string | null
          status: string
          timezone: string
          updated_at: string
          website: string | null
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          logo_key?: string | null
          name: string
          onboarding_state?: Json
          onboarding_step?: string
          phone?: string | null
          slug?: string | null
          status?: string
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          logo_key?: string | null
          name?: string
          onboarding_state?: Json
          onboarding_step?: string
          phone?: string | null
          slug?: string | null
          status?: string
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      campaign_contacts: {
        Row: {
          business_id: string
          campaign_id: string
          created_at: string
          delivered_at: string | null
          followup_sent_at: string | null
          id: string
          lead_id: string
          next_send_at: string | null
          replied_at: string | null
          sent_at: string | null
          state: string
          stopped_reason: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          campaign_id: string
          created_at?: string
          delivered_at?: string | null
          followup_sent_at?: string | null
          id?: string
          lead_id: string
          next_send_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          state?: string
          stopped_reason?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          campaign_id?: string
          created_at?: string
          delivered_at?: string | null
          followup_sent_at?: string | null
          id?: string
          lead_id?: string
          next_send_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          state?: string
          stopped_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_contacts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_contacts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          ai_personalize: boolean
          audience_label: string | null
          cancelled_at: string | null
          created_by: string | null
          description: string | null
          estimated_audience_size: number
          paused_at: string | null
          send_window_end: string
          send_window_start: string
          started_at: string | null
          tags: string[]
          timezone: string | null
          updated_by: string | null
          business_id: string
          channel: string
          completed_at: string | null
          created_at: string
          filter_config: Json
          followup_delay_seconds: number | null
          followup_template: string | null
          id: string
          launched_at: string | null
          launched_by: string | null
          message_template: string | null
          name: string
          scheduled_at: string | null
          send_rate_per_minute: number
          status: string
          suppression_summary: Json
          updated_at: string
        }
        Insert: {
          ai_personalize?: boolean
          audience_label?: string | null
          cancelled_at?: string | null
          created_by?: string | null
          description?: string | null
          estimated_audience_size?: number
          paused_at?: string | null
          send_window_end?: string
          send_window_start?: string
          started_at?: string | null
          tags?: string[]
          timezone?: string | null
          updated_by?: string | null
          business_id: string
          channel?: string
          completed_at?: string | null
          created_at?: string
          filter_config?: Json
          followup_delay_seconds?: number | null
          followup_template?: string | null
          id?: string
          launched_at?: string | null
          launched_by?: string | null
          message_template?: string | null
          name: string
          scheduled_at?: string | null
          send_rate_per_minute?: number
          status?: string
          suppression_summary?: Json
          updated_at?: string
        }
        Update: {
          ai_personalize?: boolean
          audience_label?: string | null
          cancelled_at?: string | null
          created_by?: string | null
          description?: string | null
          estimated_audience_size?: number
          paused_at?: string | null
          send_window_end?: string
          send_window_start?: string
          started_at?: string | null
          tags?: string[]
          timezone?: string | null
          updated_by?: string | null
          business_id?: string
          channel?: string
          completed_at?: string | null
          created_at?: string
          filter_config?: Json
          followup_delay_seconds?: number | null
          followup_template?: string | null
          id?: string
          launched_at?: string | null
          launched_by?: string | null
          message_template?: string | null
          name?: string
          scheduled_at?: string | null
          send_rate_per_minute?: number
          status?: string
          suppression_summary?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_suppressions: {
        Row: {
          business_id: string
          channel: string
          created_at: string
          id: string
          normalized_contact: string
          reason: string
          source: string | null
        }
        Insert: {
          business_id: string
          channel: string
          created_at?: string
          id?: string
          normalized_contact: string
          reason: string
          source?: string | null
        }
        Update: {
          business_id?: string
          channel?: string
          created_at?: string
          id?: string
          normalized_contact?: string
          reason?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_suppressions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          business_id: string
          channel: string
          created_at: string
          current_question_id: string | null
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_outbound_at: string | null
          lead_id: string
          state: string
          updated_at: string
        }
        Insert: {
          business_id: string
          channel: string
          created_at?: string
          current_question_id?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          lead_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          channel?: string
          created_at?: string
          current_question_id?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          lead_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_current_question_id_fkey"
            columns: ["current_question_id"]
            isOneToOne: false
            referencedRelation: "qualification_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_events: {
        Row: {
          business_id: string | null
          currency: string
          estimated: boolean
          id: string
          metric: string
          occurred_at: string
          provider: string
          quantity: number
          reconciled: boolean
          source_event_id: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          business_id?: string | null
          currency?: string
          estimated?: boolean
          id?: string
          metric: string
          occurred_at?: string
          provider: string
          quantity: number
          reconciled?: boolean
          source_event_id?: string | null
          total_cost: number
          unit_cost: number
        }
        Update: {
          business_id?: string | null
          currency?: string
          estimated?: boolean
          id?: string
          metric?: string
          occurred_at?: string
          provider?: string
          quantity?: number
          reconciled?: boolean
          source_event_id?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "cost_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_push_records: {
        Row: {
          business_id: string
          created_at: string
          external_contact_id: string | null
          external_deal_id: string | null
          id: string
          last_error: string | null
          lead_id: string
          provider_type: string
          pushed_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          external_contact_id?: string | null
          external_deal_id?: string | null
          id?: string
          last_error?: string | null
          lead_id: string
          provider_type: string
          pushed_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          external_contact_id?: string | null
          external_deal_id?: string | null
          id?: string
          last_error?: string | null
          lead_id?: string
          provider_type?: string
          pushed_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_push_records_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_push_records_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      field_mappings: {
        Row: {
          business_id: string
          created_at: string
          external_field: string
          id: string
          integration_object_id: string
          internal_field: string
          transform: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          external_field: string
          id?: string
          integration_object_id: string
          internal_field: string
          transform?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          external_field?: string
          id?: string
          integration_object_id?: string
          internal_field?: string
          transform?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_mappings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_mappings_integration_object_id_fkey"
            columns: ["integration_object_id"]
            isOneToOne: false
            referencedRelation: "integration_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          errors: Json
          file_key: string
          id: string
          imported_count: number
          invalid_count: number
          original_filename: string | null
          row_count: number
          status: string
          updated_at: string
          valid_count: number
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          errors?: Json
          file_key: string
          id?: string
          imported_count?: number
          invalid_count?: number
          original_filename?: string | null
          row_count?: number
          status?: string
          updated_at?: string
          valid_count?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          errors?: Json
          file_key?: string
          id?: string
          imported_count?: number
          invalid_count?: number
          original_filename?: string | null
          row_count?: number
          status?: string
          updated_at?: string
          valid_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "imports_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_oauth_states: {
        Row: {
          business_id: string
          created_at: string
          expires_at: string
          provider_type: string
          redirect_step: string | null
          state: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          expires_at?: string
          provider_type: string
          redirect_step?: string | null
          state: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          expires_at?: string
          provider_type?: string
          redirect_step?: string | null
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_oauth_states_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_objects: {
        Row: {
          business_id: string
          config: Json
          created_at: string
          enabled: boolean
          external_id: string
          id: string
          integration_id: string
          name: string | null
          object_type: string
          updated_at: string
        }
        Insert: {
          business_id: string
          config?: Json
          created_at?: string
          enabled?: boolean
          external_id: string
          id?: string
          integration_id: string
          name?: string | null
          object_type: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          config?: Json
          created_at?: string
          enabled?: boolean
          external_id?: string
          id?: string
          integration_id?: string
          name?: string | null
          object_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_objects_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_objects_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_secrets: {
        Row: {
          access_token: string | null
          business_id: string
          created_at: string
          extra: Json
          integration_id: string
          refresh_token: string | null
          token_expires_at: string | null
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          access_token?: string | null
          business_id: string
          created_at?: string
          extra?: Json
          integration_id: string
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          access_token?: string | null
          business_id?: string
          created_at?: string
          extra?: Json
          integration_id?: string
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_secrets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_secrets_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: true
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          business_id: string
          config: Json
          connected_by: string | null
          created_at: string
          display_name: string | null
          external_account_id: string | null
          id: string
          last_error_at: string | null
          last_error_code: string | null
          last_error_message: string | null
          last_success_at: string | null
          provider_type: string
          scopes: string[]
          status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          config?: Json
          connected_by?: string | null
          created_at?: string
          display_name?: string | null
          external_account_id?: string | null
          id?: string
          last_error_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_success_at?: string | null
          provider_type: string
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          config?: Json
          connected_by?: string | null
          created_at?: string
          display_name?: string | null
          external_account_id?: string | null
          id?: string
          last_error_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_success_at?: string | null
          provider_type?: string
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          business_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          priority: number
          run_at: string
          state: string
          type: string
        }
        Insert: {
          attempts?: number
          business_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          run_at?: string
          state?: string
          type: string
        }
        Update: {
          attempts?: number
          business_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          run_at?: string
          state?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          business_id: string
          id: string
          lead_id: string
          unassigned_at: string | null
          user_id: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          business_id: string
          id?: string
          lead_id: string
          unassigned_at?: string | null
          user_id?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          business_id?: string
          id?: string
          lead_id?: string
          unassigned_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_assignments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_source_cursors: {
        Row: {
          business_id: string
          cursor_value: string | null
          external_object_id: string | null
          integration_id: string
          last_polled_at: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          cursor_value?: string | null
          external_object_id?: string | null
          integration_id: string
          last_polled_at?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          cursor_value?: string | null
          external_object_id?: string | null
          integration_id?: string
          last_polled_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_source_cursors_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_source_cursors_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: true
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_sources: {
        Row: {
          ad_id: string | null
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          business_id: string
          campaign_id: string | null
          campaign_name: string | null
          created_at: string
          form_id: string | null
          form_name: string | null
          id: string
          page_id: string | null
          page_name: string | null
          provider: string
          raw_metadata: Json
          source_name: string | null
        }
        Insert: {
          ad_id?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          business_id: string
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string
          form_id?: string | null
          form_name?: string | null
          id?: string
          page_id?: string | null
          page_name?: string | null
          provider?: string
          raw_metadata?: Json
          source_name?: string | null
        }
        Update: {
          ad_id?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          business_id?: string
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string
          form_id?: string | null
          form_name?: string | null
          id?: string
          page_id?: string | null
          page_name?: string | null
          provider?: string
          raw_metadata?: Json
          source_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_sources_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_user_id: string | null
          attention_reason: string | null
          automation_active: boolean
          booked_at: string | null
          business_id: string
          created_at: string
          email: string | null
          external_id: string | null
          first_contacted_at: string | null
          first_name: string | null
          first_replied_at: string | null
          human_takeover: boolean
          id: string
          is_test: boolean
          last_contact_at: string | null
          last_name: string | null
          lost_at: string | null
          needs_attention: boolean
          notes: string | null
          opted_out: boolean
          phone: string | null
          phone_normalized: string | null
          postcode: string | null
          qualification_reason: Json
          qualification_state: string
          qualified_at: string | null
          service_id: string | null
          source_id: string | null
          status: string
          updated_at: string
          won_at: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          attention_reason?: string | null
          automation_active?: boolean
          booked_at?: string | null
          business_id: string
          created_at?: string
          email?: string | null
          external_id?: string | null
          first_contacted_at?: string | null
          first_name?: string | null
          first_replied_at?: string | null
          human_takeover?: boolean
          id?: string
          is_test?: boolean
          last_contact_at?: string | null
          last_name?: string | null
          lost_at?: string | null
          needs_attention?: boolean
          notes?: string | null
          opted_out?: boolean
          phone?: string | null
          phone_normalized?: string | null
          postcode?: string | null
          qualification_reason?: Json
          qualification_state?: string
          qualified_at?: string | null
          service_id?: string | null
          source_id?: string | null
          status?: string
          updated_at?: string
          won_at?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          attention_reason?: string | null
          automation_active?: boolean
          booked_at?: string | null
          business_id?: string
          created_at?: string
          email?: string | null
          external_id?: string | null
          first_contacted_at?: string | null
          first_name?: string | null
          first_replied_at?: string | null
          human_takeover?: boolean
          id?: string
          is_test?: boolean
          last_contact_at?: string | null
          last_name?: string | null
          lost_at?: string | null
          needs_attention?: boolean
          notes?: string | null
          opted_out?: boolean
          phone?: string | null
          phone_normalized?: string | null
          postcode?: string | null
          qualification_reason?: Json
          qualification_state?: string
          qualified_at?: string | null
          service_id?: string | null
          source_id?: string | null
          status?: string
          updated_at?: string
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "lead_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_events: {
        Row: {
          cta_placement: string | null
          event_name: string
          id: string
          metadata: Json
          occurred_at: string
          session_id: string | null
        }
        Insert: {
          cta_placement?: string | null
          event_name: string
          id?: string
          metadata?: Json
          occurred_at?: string
          session_id?: string | null
        }
        Update: {
          cta_placement?: string | null
          event_name?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "marketing_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_sessions: {
        Row: {
          anonymous_id: string
          converted_at: string | null
          converted_user_id: string | null
          first_seen_at: string
          id: string
          landing_path: string | null
          referrer: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          anonymous_id: string
          converted_at?: string | null
          converted_user_id?: string | null
          first_seen_at?: string
          id?: string
          landing_path?: string | null
          referrer?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          anonymous_id?: string
          converted_at?: string | null
          converted_user_id?: string | null
          first_seen_at?: string
          id?: string
          landing_path?: string | null
          referrer?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      message_events: {
        Row: {
          business_id: string
          error_code: string | null
          event_type: string
          id: string
          message_id: string
          occurred_at: string
          payload: Json
          provider_status: string | null
        }
        Insert: {
          business_id: string
          error_code?: string | null
          event_type: string
          id?: string
          message_id: string
          occurred_at?: string
          payload?: Json
          provider_status?: string | null
        }
        Update: {
          business_id?: string
          error_code?: string | null
          event_type?: string
          id?: string
          message_id?: string
          occurred_at?: string
          payload?: Json
          provider_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          automation_run_id: string | null
          body: string
          business_id: string
          campaign_id: string | null
          channel: string
          conversation_id: string
          cost_amount: number | null
          cost_currency: string | null
          created_at: string
          delivered_at: string | null
          direction: string
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          lead_id: string
          origin: string
          provider: string | null
          provider_message_id: string | null
          received_at: string | null
          scheduled_for: string | null
          send_key: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          automation_run_id?: string | null
          body: string
          business_id: string
          campaign_id?: string | null
          channel: string
          conversation_id: string
          cost_amount?: number | null
          cost_currency?: string | null
          created_at?: string
          delivered_at?: string | null
          direction: string
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          lead_id: string
          origin?: string
          provider?: string | null
          provider_message_id?: string | null
          received_at?: string | null
          scheduled_for?: string | null
          send_key?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          automation_run_id?: string | null
          body?: string
          business_id?: string
          campaign_id?: string | null
          channel?: string
          conversation_id?: string
          cost_amount?: number | null
          cost_currency?: string | null
          created_at?: string
          delivered_at?: string | null
          direction?: string
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          lead_id?: string
          origin?: string
          provider?: string | null
          provider_message_id?: string | null
          received_at?: string | null
          scheduled_for?: string | null
          send_key?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_automation_run_fk"
            columns: ["automation_run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          business_id: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          link_url: string | null
          read_at: string | null
          severity: string
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          business_id: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link_url?: string | null
          read_at?: string | null
          severity?: string
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          business_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link_url?: string | null
          read_at?: string | null
          severity?: string
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_entitlements: {
        Row: {
          created_at: string
          hard_limit: number | null
          id: string
          metric: string
          overage_allowed: boolean
          overage_price: number | null
          plan_key: string
          soft_limit: number | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          hard_limit?: number | null
          id?: string
          metric: string
          overage_allowed?: boolean
          overage_price?: number | null
          plan_key: string
          soft_limit?: number | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          hard_limit?: number | null
          id?: string
          metric?: string
          overage_allowed?: boolean
          overage_price?: number | null
          plan_key?: string
          soft_limit?: number | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          platform_role: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          phone?: string | null
          platform_role?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          platform_role?: string
          updated_at?: string
        }
        Relationships: []
      }
      provider_price_book: {
        Row: {
          created_at: string
          currency: string
          effective_from: string
          effective_to: string | null
          id: string
          metadata: Json
          product: string
          provider: string
          region: string | null
          unit: string
          unit_cost: number
        }
        Insert: {
          created_at?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          metadata?: Json
          product: string
          provider: string
          region?: string | null
          unit: string
          unit_cost: number
        }
        Update: {
          created_at?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          metadata?: Json
          product?: string
          provider?: string
          region?: string | null
          unit?: string
          unit_cost?: number
        }
        Relationships: []
      }
      qualification_answers: {
        Row: {
          answer_text: string | null
          answer_value: string | null
          answered_at: string
          business_id: string
          confidence: number | null
          evaluation: string
          id: string
          lead_id: string
          question_id: string
          source: string
        }
        Insert: {
          answer_text?: string | null
          answer_value?: string | null
          answered_at?: string
          business_id: string
          confidence?: number | null
          evaluation?: string
          id?: string
          lead_id: string
          question_id: string
          source?: string
        }
        Update: {
          answer_text?: string | null
          answer_value?: string | null
          answered_at?: string
          business_id?: string
          confidence?: number | null
          evaluation?: string
          id?: string
          lead_id?: string
          question_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_answers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualification_answers_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualification_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "qualification_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      qualification_options: {
        Row: {
          business_id: string
          created_at: string
          id: string
          label: string
          position: number
          question_id: string
          value: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          label: string
          position?: number
          question_id: string
          value: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          label?: string
          position?: number
          question_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_options_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualification_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "qualification_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      qualification_questions: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          help_text: string | null
          id: string
          position: number
          question_text: string
          required: boolean
          response_type: string
          service_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          help_text?: string | null
          id?: string
          position?: number
          question_text: string
          required?: boolean
          response_type: string
          service_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          help_text?: string | null
          id?: string
          position?: number
          question_text?: string
          required?: boolean
          response_type?: string
          service_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_questions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualification_questions_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      qualification_rules: {
        Row: {
          active: boolean
          business_id: string
          comparison_value: Json
          created_at: string
          id: string
          operator: string
          priority: number
          question_id: string | null
          result: string
          rule_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          business_id: string
          comparison_value?: Json
          created_at?: string
          id?: string
          operator: string
          priority?: number
          question_id?: string | null
          result?: string
          rule_type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          business_id?: string
          comparison_value?: Json
          created_at?: string
          id?: string
          operator?: string
          priority?: number
          question_id?: string | null
          result?: string
          rule_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_rules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualification_rules_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "qualification_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          identifier: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          identifier: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          identifier?: string
          window_start?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          active: boolean
          average_value: number | null
          business_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          average_value?: number | null
          business_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          average_value?: number | null
          business_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          ai_assist_allowed: boolean
          billing_interval: string | null
          business_id: string
          campaigns_enabled: boolean
          cancel_at_period_end: boolean
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          lead_limit: number
          plan: string
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
          user_limit: number
          whatsapp_enabled: boolean
        }
        Insert: {
          ai_assist_allowed?: boolean
          billing_interval?: string | null
          business_id: string
          campaigns_enabled?: boolean
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          lead_limit?: number
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
          user_limit?: number
          whatsapp_enabled?: boolean
        }
        Update: {
          ai_assist_allowed?: boolean
          billing_interval?: string | null
          business_id?: string
          campaigns_enabled?: boolean
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          lead_limit?: number
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
          user_limit?: number
          whatsapp_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_counters: {
        Row: {
          business_id: string
          computed_at: string
          id: string
          metric: string
          period_end: string
          period_start: string
          quantity: number
          updated_at: string
        }
        Insert: {
          business_id: string
          computed_at?: string
          id?: string
          metric: string
          period_end: string
          period_start: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          computed_at?: string
          id?: string
          metric?: string
          period_end?: string
          period_start?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_counters_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          business_id: string
          currency: string | null
          id: string
          metadata: Json
          metric: string
          occurred_at: string
          quantity: number
          source: string | null
          unit_cost: number | null
        }
        Insert: {
          business_id: string
          currency?: string | null
          id?: string
          metadata?: Json
          metric: string
          occurred_at?: string
          quantity?: number
          source?: string | null
          unit_cost?: number | null
        }
        Update: {
          business_id?: string
          currency?: string | null
          id?: string
          metadata?: Json
          metric?: string
          occurred_at?: string
          quantity?: number
          source?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          attempts: number
          business_id: string | null
          event_type: string | null
          external_event_id: string
          id: string
          last_error: string | null
          payload: Json | null
          payload_hash: string | null
          processed_at: string | null
          provider: string
          received_at: string
          status: string
        }
        Insert: {
          attempts?: number
          business_id?: string | null
          event_type?: string | null
          external_event_id: string
          id?: string
          last_error?: string | null
          payload?: Json | null
          payload_hash?: string | null
          processed_at?: string | null
          provider: string
          received_at?: string
          status?: string
        }
        Update: {
          attempts?: number
          business_id?: string | null
          event_type?: string | null
          external_event_id?: string
          id?: string
          last_error?: string | null
          payload?: Json | null
          payload_hash?: string | null
          processed_at?: string | null
          provider?: string
          received_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_jobs: {
        Args: { batch_size: number; worker: string }
        Returns: {
          attempts: number
          business_id: string
          id: string
          max_attempts: number
          payload: Json
          type: string
        }[]
      }
      consume_rate_limit: {
        Args: {
          p_bucket: string
          p_identifier: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          retry_after: number
        }[]
      }
      has_business_role: {
        Args: { allowed_roles: string[]; target_business_id: string }
        Returns: boolean
      }
      is_business_member: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      prune_oauth_states: { Args: never; Returns: number }
      prune_rate_limits: { Args: { older_than?: string }; Returns: number }
      reap_stalled_jobs: { Args: { stale_after?: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
