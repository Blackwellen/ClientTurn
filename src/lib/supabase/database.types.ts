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
      affiliate_attributions: {
        Row: {
          affiliate_id: string
          attributed_at: string
          attribution_model: string
          business_id: string | null
          clicked_at: string | null
          expires_at: string | null
          id: string
          link_id: string | null
          promo_code_id: string | null
          rejected_reason: string | null
          user_id: string | null
          visitor_hash: string | null
        }
        Insert: {
          affiliate_id: string
          attributed_at?: string
          attribution_model?: string
          business_id?: string | null
          clicked_at?: string | null
          expires_at?: string | null
          id?: string
          link_id?: string | null
          promo_code_id?: string | null
          rejected_reason?: string | null
          user_id?: string | null
          visitor_hash?: string | null
        }
        Update: {
          affiliate_id?: string
          attributed_at?: string
          attribution_model?: string
          business_id?: string | null
          clicked_at?: string | null
          expires_at?: string | null
          id?: string
          link_id?: string | null
          promo_code_id?: string | null
          rejected_reason?: string | null
          user_id?: string | null
          visitor_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_attributions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_attributions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_attributions_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "affiliate_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_attributions_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "affiliate_promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_campaigns: {
        Row: {
          affiliate_id: string
          archived: boolean
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          affiliate_id: string
          archived?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          affiliate_id?: string
          archived?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_campaigns_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_clicks: {
        Row: {
          affiliate_id: string
          campaign_id: string | null
          country: string | null
          device_type: string | null
          id: string
          is_bot: boolean
          landing_path: string | null
          link_id: string | null
          occurred_at: string
          referrer_host: string | null
          visitor_hash: string
        }
        Insert: {
          affiliate_id: string
          campaign_id?: string | null
          country?: string | null
          device_type?: string | null
          id?: string
          is_bot?: boolean
          landing_path?: string | null
          link_id?: string | null
          occurred_at?: string
          referrer_host?: string | null
          visitor_hash: string
        }
        Update: {
          affiliate_id?: string
          campaign_id?: string | null
          country?: string | null
          device_type?: string | null
          id?: string
          is_bot?: boolean
          landing_path?: string | null
          link_id?: string | null
          occurred_at?: string
          referrer_host?: string | null
          visitor_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_clicks_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_clicks_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "affiliate_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_clicks_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "affiliate_links"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_commission_plans: {
        Row: {
          active: boolean
          attribution_window_days: number
          commission_type: string
          cookie_window_days: number
          created_at: string
          currency: string
          description: string | null
          flat_amount_minor: number | null
          hold_days: number
          id: string
          is_default: boolean
          minimum_payout_minor: number
          name: string
          percent: number | null
          recurring_months: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          attribution_window_days?: number
          commission_type?: string
          cookie_window_days?: number
          created_at?: string
          currency?: string
          description?: string | null
          flat_amount_minor?: number | null
          hold_days?: number
          id?: string
          is_default?: boolean
          minimum_payout_minor?: number
          name: string
          percent?: number | null
          recurring_months?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          attribution_window_days?: number
          commission_type?: string
          cookie_window_days?: number
          created_at?: string
          currency?: string
          description?: string | null
          flat_amount_minor?: number | null
          hold_days?: number
          id?: string
          is_default?: boolean
          minimum_payout_minor?: number
          name?: string
          percent?: number | null
          recurring_months?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      affiliate_commissions: {
        Row: {
          affiliate_id: string
          approved_at: string | null
          approved_by: string | null
          base_amount_minor: number
          business_id: string | null
          commission_amount_minor: number
          commission_plan_id: string | null
          created_at: string
          currency: string
          id: string
          paid_at: string | null
          payable_at: string | null
          payout_id: string | null
          period_month: string | null
          referral_id: string | null
          reversal_reason: string | null
          reversed_at: string | null
          status: string
          stripe_invoice_id: string | null
        }
        Insert: {
          affiliate_id: string
          approved_at?: string | null
          approved_by?: string | null
          base_amount_minor?: number
          business_id?: string | null
          commission_amount_minor?: number
          commission_plan_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string | null
          payable_at?: string | null
          payout_id?: string | null
          period_month?: string | null
          referral_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          status?: string
          stripe_invoice_id?: string | null
        }
        Update: {
          affiliate_id?: string
          approved_at?: string | null
          approved_by?: string | null
          base_amount_minor?: number
          business_id?: string | null
          commission_amount_minor?: number
          commission_plan_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string | null
          payable_at?: string | null
          payout_id?: string | null
          period_month?: string | null
          referral_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          status?: string
          stripe_invoice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_commission_plan_id_fkey"
            columns: ["commission_plan_id"]
            isOneToOne: false
            referencedRelation: "affiliate_commission_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_payout_fk"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "affiliate_payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "affiliate_referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_links: {
        Row: {
          affiliate_id: string
          archived: boolean
          campaign_id: string | null
          click_count: number
          created_at: string
          destination_path: string
          id: string
          label: string
          paid_count: number
          signup_count: number
          slug: string
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          affiliate_id: string
          archived?: boolean
          campaign_id?: string | null
          click_count?: number
          created_at?: string
          destination_path?: string
          id?: string
          label: string
          paid_count?: number
          signup_count?: number
          slug: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          affiliate_id?: string
          archived?: boolean
          campaign_id?: string | null
          click_count?: number
          created_at?: string
          destination_path?: string
          id?: string
          label?: string
          paid_count?: number
          signup_count?: number
          slug?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_links_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_links_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "affiliate_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_payouts: {
        Row: {
          affiliate_id: string
          amount_minor: number
          approved_at: string | null
          approved_by: string | null
          batch_reference: string | null
          commission_count: number
          created_at: string
          currency: string
          external_reference: string | null
          failure_reason: string | null
          id: string
          method: string | null
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          status: string
          updated_at: string
        }
        Insert: {
          affiliate_id: string
          amount_minor?: number
          approved_at?: string | null
          approved_by?: string | null
          batch_reference?: string | null
          commission_count?: number
          created_at?: string
          currency?: string
          external_reference?: string | null
          failure_reason?: string | null
          id?: string
          method?: string | null
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          affiliate_id?: string
          amount_minor?: number
          approved_at?: string | null
          approved_by?: string | null
          batch_reference?: string | null
          commission_count?: number
          created_at?: string
          currency?: string
          external_reference?: string | null
          failure_reason?: string | null
          id?: string
          method?: string | null
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_payouts_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_promo_codes: {
        Row: {
          affiliate_id: string | null
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          discount_amount_minor: number | null
          discount_percent: number | null
          expires_at: string | null
          id: string
          max_redemptions: number | null
          redemption_count: number
          status: string
          stripe_promotion_code_id: string | null
        }
        Insert: {
          affiliate_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_amount_minor?: number | null
          discount_percent?: number | null
          expires_at?: string | null
          id?: string
          max_redemptions?: number | null
          redemption_count?: number
          status?: string
          stripe_promotion_code_id?: string | null
        }
        Update: {
          affiliate_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_amount_minor?: number | null
          discount_percent?: number | null
          expires_at?: string | null
          id?: string
          max_redemptions?: number | null
          redemption_count?: number
          status?: string
          stripe_promotion_code_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_promo_codes_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_referrals: {
        Row: {
          affiliate_id: string
          attribution_expires_at: string | null
          attribution_id: string | null
          business_id: string
          churned_at: string | null
          created_at: string
          display_label: string | null
          id: string
          lifetime_revenue_minor: number
          paid_at: string | null
          plan_key: string | null
          signup_at: string | null
          status: string
          trial_at: string | null
          updated_at: string
        }
        Insert: {
          affiliate_id: string
          attribution_expires_at?: string | null
          attribution_id?: string | null
          business_id: string
          churned_at?: string | null
          created_at?: string
          display_label?: string | null
          id?: string
          lifetime_revenue_minor?: number
          paid_at?: string | null
          plan_key?: string | null
          signup_at?: string | null
          status?: string
          trial_at?: string | null
          updated_at?: string
        }
        Update: {
          affiliate_id?: string
          attribution_expires_at?: string | null
          attribution_id?: string | null
          business_id?: string
          churned_at?: string | null
          created_at?: string
          display_label?: string | null
          id?: string
          lifetime_revenue_minor?: number
          paid_at?: string | null
          plan_key?: string | null
          signup_at?: string | null
          status?: string
          trial_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_referrals_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_referrals_attribution_id_fkey"
            columns: ["attribution_id"]
            isOneToOne: false
            referencedRelation: "affiliate_attributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_referrals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_resource_downloads: {
        Row: {
          affiliate_id: string
          downloaded_at: string
          id: string
          resource_id: string
        }
        Insert: {
          affiliate_id: string
          downloaded_at?: string
          id?: string
          resource_id: string
        }
        Update: {
          affiliate_id?: string
          downloaded_at?: string
          id?: string
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_resource_downloads_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_resource_downloads_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "affiliate_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_resources: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          dimensions: string | null
          download_count: number
          external_url: string | null
          file_size_bytes: number | null
          id: string
          keywords: string[]
          pack_id: string | null
          preview_key: string | null
          resource_type: string
          sort_order: number
          status: string
          storage_key: string | null
          text_content: string | null
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          dimensions?: string | null
          download_count?: number
          external_url?: string | null
          file_size_bytes?: number | null
          id?: string
          keywords?: string[]
          pack_id?: string | null
          preview_key?: string | null
          resource_type?: string
          sort_order?: number
          status?: string
          storage_key?: string | null
          text_content?: string | null
          title: string
          updated_at?: string
          version?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          dimensions?: string | null
          download_count?: number
          external_url?: string | null
          file_size_bytes?: number | null
          id?: string
          keywords?: string[]
          pack_id?: string | null
          preview_key?: string | null
          resource_type?: string
          sort_order?: number
          status?: string
          storage_key?: string | null
          text_content?: string | null
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_resources_pack_fk"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "affiliate_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          audience_description: string | null
          code: string
          commission_plan_id: string | null
          company_name: string | null
          contact_email: string
          country: string | null
          created_at: string
          display_name: string
          id: string
          payment_profile_json: Json
          promotion_methods: string[]
          status: string
          status_reason: string | null
          tax_status: string
          updated_at: string
          user_id: string
          website_url: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          audience_description?: string | null
          code: string
          commission_plan_id?: string | null
          company_name?: string | null
          contact_email: string
          country?: string | null
          created_at?: string
          display_name: string
          id?: string
          payment_profile_json?: Json
          promotion_methods?: string[]
          status?: string
          status_reason?: string | null
          tax_status?: string
          updated_at?: string
          user_id: string
          website_url?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          audience_description?: string | null
          code?: string
          commission_plan_id?: string | null
          company_name?: string | null
          contact_email?: string
          country?: string | null
          created_at?: string
          display_name?: string
          id?: string
          payment_profile_json?: Json
          promotion_methods?: string[]
          status?: string
          status_reason?: string | null
          tax_status?: string
          updated_at?: string
          user_id?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliates_commission_plan_fk"
            columns: ["commission_plan_id"]
            isOneToOne: false
            referencedRelation: "affiliate_commission_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_activity_events: {
        Row: {
          actor_user_id: string | null
          agent_id: string
          business_id: string
          created_at: string
          detail: string | null
          event_type: string
          id: string
          metadata: Json
          severity: string
          subject_id: string | null
          subject_type: string | null
          title: string
        }
        Insert: {
          actor_user_id?: string | null
          agent_id: string
          business_id: string
          created_at?: string
          detail?: string | null
          event_type: string
          id?: string
          metadata?: Json
          severity?: string
          subject_id?: string | null
          subject_type?: string | null
          title: string
        }
        Update: {
          actor_user_id?: string | null
          agent_id?: string
          business_id?: string
          created_at?: string
          detail?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          severity?: string
          subject_id?: string | null
          subject_type?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_activity_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_activity_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_budgets: {
        Row: {
          blocked_count: number
          budget_minor: number
          business_id: string
          id: string
          period_end: string
          period_start: string
          reserved_minor: number
          scope: string
          spent_minor: number
          updated_at: string
        }
        Insert: {
          blocked_count?: number
          budget_minor?: number
          business_id: string
          id?: string
          period_end: string
          period_start: string
          reserved_minor?: number
          scope?: string
          spent_minor?: number
          updated_at?: string
        }
        Update: {
          blocked_count?: number
          budget_minor?: number
          business_id?: string
          id?: string
          period_end?: string
          period_start?: string
          reserved_minor?: number
          scope?: string
          spent_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_budgets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_handoffs: {
        Row: {
          acknowledged_at: string | null
          agent_run_id: string | null
          assigned_user_id: string | null
          business_id: string
          conversation_id: string | null
          created_at: string
          id: string
          lead_id: string
          priority: string
          reason: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          summary_json: Json
        }
        Insert: {
          acknowledged_at?: string | null
          agent_run_id?: string | null
          assigned_user_id?: string | null
          business_id: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          lead_id: string
          priority?: string
          reason: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          summary_json?: Json
        }
        Update: {
          acknowledged_at?: string | null
          agent_run_id?: string | null
          assigned_user_id?: string | null
          business_id?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          priority?: string
          reason?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          summary_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_handoffs_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "conversation_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_handoffs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_handoffs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_handoffs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_prompt_versions: {
        Row: {
          agent_type: string
          created_at: string
          id: string
          max_output_tokens: number
          model_hint: string | null
          notes: string | null
          prompt_key: string
          schema_version: number
          status: string
          system_prompt: string
          version: string
        }
        Insert: {
          agent_type: string
          created_at?: string
          id?: string
          max_output_tokens?: number
          model_hint?: string | null
          notes?: string | null
          prompt_key: string
          schema_version?: number
          status?: string
          system_prompt: string
          version: string
        }
        Update: {
          agent_type?: string
          created_at?: string
          id?: string
          max_output_tokens?: number
          model_hint?: string | null
          notes?: string | null
          prompt_key?: string
          schema_version?: number
          status?: string
          system_prompt?: string
          version?: string
        }
        Relationships: []
      }
      agent_queue_items: {
        Row: {
          agent_id: string
          attempts: number
          blocked_reason: string | null
          business_id: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          item_type: string
          max_attempts: number
          priority: number
          scheduled_for: string
          started_at: string | null
          status: string
          subject_id: string | null
          subject_label: string | null
          subject_type: string | null
        }
        Insert: {
          agent_id: string
          attempts?: number
          blocked_reason?: string | null
          business_id: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          item_type: string
          max_attempts?: number
          priority?: number
          scheduled_for?: string
          started_at?: string | null
          status?: string
          subject_id?: string | null
          subject_label?: string | null
          subject_type?: string | null
        }
        Update: {
          agent_id?: string
          attempts?: number
          blocked_reason?: string | null
          business_id?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          item_type?: string
          max_attempts?: number
          priority?: number
          scheduled_for?: string
          started_at?: string | null
          status?: string
          subject_id?: string | null
          subject_label?: string | null
          subject_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_queue_items_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_queue_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent_type: string
          budget_after_minor: number | null
          budget_before_minor: number | null
          business_id: string | null
          cached_tokens: number
          completed_at: string | null
          confidence: number | null
          created_at: string
          deployment: string
          error_code: string | null
          id: string
          input_tokens: number
          latency_ms: number | null
          model_cost_minor: number
          output_tokens: number
          parent_run_id: string | null
          prompt_key: string
          prompt_version: string
          provider_cost_minor: number
          result_json: Json | null
          status: string
          subject_id: string | null
          subject_type: string | null
          tool_call_count: number
          trace_id: string | null
        }
        Insert: {
          agent_type: string
          budget_after_minor?: number | null
          budget_before_minor?: number | null
          business_id?: string | null
          cached_tokens?: number
          completed_at?: string | null
          confidence?: number | null
          created_at?: string
          deployment: string
          error_code?: string | null
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model_cost_minor?: number
          output_tokens?: number
          parent_run_id?: string | null
          prompt_key: string
          prompt_version: string
          provider_cost_minor?: number
          result_json?: Json | null
          status?: string
          subject_id?: string | null
          subject_type?: string | null
          tool_call_count?: number
          trace_id?: string | null
        }
        Update: {
          agent_type?: string
          budget_after_minor?: number | null
          budget_before_minor?: number | null
          business_id?: string | null
          cached_tokens?: number
          completed_at?: string | null
          confidence?: number | null
          created_at?: string
          deployment?: string
          error_code?: string | null
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model_cost_minor?: number
          output_tokens?: number
          parent_run_id?: string | null
          prompt_key?: string
          prompt_version?: string
          provider_cost_minor?: number
          result_json?: Json | null
          status?: string
          subject_id?: string | null
          subject_type?: string | null
          tool_call_count?: number
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_sources: {
        Row: {
          agent_id: string
          business_id: string
          config_json: Json
          created_at: string
          enabled: boolean
          error_message: string | null
          id: string
          last_run_at: string | null
          prospects_found: number
          source_key: string
          status: string
          status_detail: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          business_id: string
          config_json?: Json
          created_at?: string
          enabled?: boolean
          error_message?: string | null
          id?: string
          last_run_at?: string | null
          prospects_found?: number
          source_key: string
          status?: string
          status_detail?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          business_id?: string
          config_json?: Json
          created_at?: string
          enabled?: boolean
          error_message?: string | null
          id?: string
          last_run_at?: string | null
          prospects_found?: number
          source_key?: string
          status?: string
          status_detail?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_sources_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_sources_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tool_calls: {
        Row: {
          agent_run_id: string
          arguments_json: Json
          business_id: string | null
          cost_minor: number
          created_at: string
          denial_reason: string | null
          id: string
          latency_ms: number | null
          result_summary: string | null
          status: string
          tool_name: string
        }
        Insert: {
          agent_run_id: string
          arguments_json?: Json
          business_id?: string | null
          cost_minor?: number
          created_at?: string
          denial_reason?: string | null
          id?: string
          latency_ms?: number | null
          result_summary?: string | null
          status?: string
          tool_name: string
        }
        Update: {
          agent_run_id?: string
          arguments_json?: Json
          business_id?: string | null
          cost_minor?: number
          created_at?: string
          denial_reason?: string | null
          id?: string
          latency_ms?: number | null
          result_summary?: string | null
          status?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tool_calls_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_calls_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          activated_at: string | null
          agent_type: string
          auto_promote_to_leads: boolean
          autonomy: string
          business_id: string
          cadence: string
          campaign_id: string | null
          conversion_goal_id: string | null
          created_at: string
          created_by: string | null
          daily_prospect_cap: number
          description: string | null
          enrich_email: boolean
          enrich_phone: boolean
          icp_profile_id: string | null
          id: string
          last_run_at: string | null
          last_run_status: string | null
          max_cost_per_run_minor: number
          minimum_grade: string
          monthly_prospect_cap: number
          name: string
          next_run_at: string | null
          paused_at: string | null
          pending_review_count: number
          run_window_end: string
          run_window_start: string
          search_strategy_id: string | null
          service_id: string | null
          status: string
          status_reason: string | null
          timezone: string | null
          total_conversions: number
          total_leads: number
          total_prospects: number
          updated_at: string
          verify_email: boolean
        }
        Insert: {
          activated_at?: string | null
          agent_type: string
          auto_promote_to_leads?: boolean
          autonomy?: string
          business_id: string
          cadence?: string
          campaign_id?: string | null
          conversion_goal_id?: string | null
          created_at?: string
          created_by?: string | null
          daily_prospect_cap?: number
          description?: string | null
          enrich_email?: boolean
          enrich_phone?: boolean
          icp_profile_id?: string | null
          id?: string
          last_run_at?: string | null
          last_run_status?: string | null
          max_cost_per_run_minor?: number
          minimum_grade?: string
          monthly_prospect_cap?: number
          name: string
          next_run_at?: string | null
          paused_at?: string | null
          pending_review_count?: number
          run_window_end?: string
          run_window_start?: string
          search_strategy_id?: string | null
          service_id?: string | null
          status?: string
          status_reason?: string | null
          timezone?: string | null
          total_conversions?: number
          total_leads?: number
          total_prospects?: number
          updated_at?: string
          verify_email?: boolean
        }
        Update: {
          activated_at?: string | null
          agent_type?: string
          auto_promote_to_leads?: boolean
          autonomy?: string
          business_id?: string
          cadence?: string
          campaign_id?: string | null
          conversion_goal_id?: string | null
          created_at?: string
          created_by?: string | null
          daily_prospect_cap?: number
          description?: string | null
          enrich_email?: boolean
          enrich_phone?: boolean
          icp_profile_id?: string | null
          id?: string
          last_run_at?: string | null
          last_run_status?: string | null
          max_cost_per_run_minor?: number
          minimum_grade?: string
          monthly_prospect_cap?: number
          name?: string
          next_run_at?: string | null
          paused_at?: string | null
          pending_review_count?: number
          run_window_end?: string
          run_window_start?: string
          search_strategy_id?: string | null
          service_id?: string | null
          status?: string
          status_reason?: string | null
          timezone?: string | null
          total_conversions?: number
          total_leads?: number
          total_prospects?: number
          updated_at?: string
          verify_email?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "agents_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_conversion_goal_id_fkey"
            columns: ["conversion_goal_id"]
            isOneToOne: false
            referencedRelation: "conversion_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_icp_profile_id_fkey"
            columns: ["icp_profile_id"]
            isOneToOne: false
            referencedRelation: "icp_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_search_strategy_id_fkey"
            columns: ["search_strategy_id"]
            isOneToOne: false
            referencedRelation: "search_strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
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
          agent_answer_service_questions: boolean
          agent_channels: string[]
          agent_handover_on_review: boolean
          agent_mode: string
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
          agent_answer_service_questions?: boolean
          agent_channels?: string[]
          agent_handover_on_review?: boolean
          agent_mode?: string
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
          agent_answer_service_questions?: boolean
          agent_channels?: string[]
          agent_handover_on_review?: boolean
          agent_mode?: string
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
      business_analysis_facts: {
        Row: {
          accepted: boolean
          analysis_id: string
          business_id: string
          category: string
          confidence: number
          created_at: string
          id: string
          source_url: string | null
          value_json: Json
          verification_state: string
        }
        Insert: {
          accepted?: boolean
          analysis_id: string
          business_id: string
          category: string
          confidence?: number
          created_at?: string
          id?: string
          source_url?: string | null
          value_json?: Json
          verification_state?: string
        }
        Update: {
          accepted?: boolean
          analysis_id?: string
          business_id?: string
          category?: string
          confidence?: number
          created_at?: string
          id?: string
          source_url?: string | null
          value_json?: Json
          verification_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_analysis_facts_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "business_analysis_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_analysis_facts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_analysis_jobs: {
        Row: {
          business_id: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          facts_found: number
          id: string
          pages_analysed: number
          pages_targeted: number
          requested_by: string | null
          started_at: string | null
          status: string
          updated_at: string
          verification_state: string
          website_url: string
        }
        Insert: {
          business_id: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          facts_found?: number
          id?: string
          pages_analysed?: number
          pages_targeted?: number
          requested_by?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          verification_state?: string
          website_url: string
        }
        Update: {
          business_id?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          facts_found?: number
          id?: string
          pages_analysed?: number
          pages_targeted?: number
          requested_by?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          verification_state?: string
          website_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_analysis_jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
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
          discovery_cost: number
          email_cost: number
          enrichment_cost: number
          infrastructure_allocated_cost: number
          intent_cost: number
          other_cost: number
          sms_cost: number
          stripe_cost: number
          total_cost: number
          updated_at: string
          verification_cost: number
          whatsapp_cost: number
        }
        Insert: {
          ai_cost?: number
          business_id: string
          date: string
          discovery_cost?: number
          email_cost?: number
          enrichment_cost?: number
          infrastructure_allocated_cost?: number
          intent_cost?: number
          other_cost?: number
          sms_cost?: number
          stripe_cost?: number
          total_cost?: number
          updated_at?: string
          verification_cost?: number
          whatsapp_cost?: number
        }
        Update: {
          ai_cost?: number
          business_id?: string
          date?: string
          discovery_cost?: number
          email_cost?: number
          enrichment_cost?: number
          infrastructure_allocated_cost?: number
          intent_cost?: number
          other_cost?: number
          sms_cost?: number
          stripe_cost?: number
          total_cost?: number
          updated_at?: string
          verification_cost?: number
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
      business_entitlement_grants: {
        Row: {
          boolean_value: boolean | null
          business_id: string
          entitlement_key: string
          expires_at: string | null
          granted_at: string
          granted_by: string | null
          id: string
          numeric_value: number | null
          reason: string
          revoked_at: string | null
          text_value: string | null
        }
        Insert: {
          boolean_value?: boolean | null
          business_id: string
          entitlement_key: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          numeric_value?: number | null
          reason: string
          revoked_at?: string | null
          text_value?: string | null
        }
        Update: {
          boolean_value?: boolean | null
          business_id?: string
          entitlement_key?: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          numeric_value?: number | null
          reason?: string
          revoked_at?: string | null
          text_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_entitlement_grants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_knowledge_sources: {
        Row: {
          business_id: string
          content_hash: string | null
          created_at: string
          error_message: string | null
          extract_summary: string | null
          fetched_at: string | null
          id: string
          label: string
          source_type: string
          status: string
          updated_at: string
          url: string | null
        }
        Insert: {
          business_id: string
          content_hash?: string | null
          created_at?: string
          error_message?: string | null
          extract_summary?: string | null
          fetched_at?: string | null
          id?: string
          label: string
          source_type?: string
          status?: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          business_id?: string
          content_hash?: string | null
          created_at?: string
          error_message?: string | null
          extract_summary?: string | null
          fetched_at?: string | null
          id?: string
          label?: string
          source_type?: string
          status?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_knowledge_sources_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_learning_events: {
        Row: {
          applied: boolean
          applied_at: string | null
          business_id: string
          confidence: number
          created_at: string
          detail: string | null
          evidence_json: Json
          expires_at: string | null
          id: string
          learning_type: string
          sample_size: number
          subject_id: string | null
          subject_type: string | null
          title: string
        }
        Insert: {
          applied?: boolean
          applied_at?: string | null
          business_id: string
          confidence?: number
          created_at?: string
          detail?: string | null
          evidence_json?: Json
          expires_at?: string | null
          id?: string
          learning_type: string
          sample_size?: number
          subject_id?: string | null
          subject_type?: string | null
          title: string
        }
        Update: {
          applied?: boolean
          applied_at?: string | null
          business_id?: string
          confidence?: number
          created_at?: string
          detail?: string | null
          evidence_json?: Json
          expires_at?: string | null
          id?: string
          learning_type?: string
          sample_size?: number
          subject_id?: string | null
          subject_type?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_learning_events_business_id_fkey"
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
          breakdown_json: Json
          business_id: string
          discovery_cost: number
          email_cost: number
          enrichment_cost: number
          gross_contribution: number
          gross_margin_percent: number | null
          intent_cost: number
          margin_state: string
          overage_revenue: number
          plan_key: string | null
          sms_cost: number
          stripe_cost: number
          subscription_revenue: number
          total_cogs: number
          total_revenue: number
          updated_at: string
          verification_cost: number
          whatsapp_cost: number
        }
        Insert: {
          ai_cost?: number
          allocated_platform_cost?: number
          billing_period: string
          breakdown_json?: Json
          business_id: string
          discovery_cost?: number
          email_cost?: number
          enrichment_cost?: number
          gross_contribution?: number
          gross_margin_percent?: number | null
          intent_cost?: number
          margin_state?: string
          overage_revenue?: number
          plan_key?: string | null
          sms_cost?: number
          stripe_cost?: number
          subscription_revenue?: number
          total_cogs?: number
          total_revenue?: number
          updated_at?: string
          verification_cost?: number
          whatsapp_cost?: number
        }
        Update: {
          ai_cost?: number
          allocated_platform_cost?: number
          billing_period?: string
          breakdown_json?: Json
          business_id?: string
          discovery_cost?: number
          email_cost?: number
          enrichment_cost?: number
          gross_contribution?: number
          gross_margin_percent?: number | null
          intent_cost?: number
          margin_state?: string
          overage_revenue?: number
          plan_key?: string | null
          sms_cost?: number
          stripe_cost?: number
          subscription_revenue?: number
          total_cogs?: number
          total_revenue?: number
          updated_at?: string
          verification_cost?: number
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
      business_memory_facts: {
        Row: {
          business_id: string
          confidence: number
          created_at: string
          fact_key: string
          id: string
          last_verified_at: string | null
          locked: boolean
          source_id: string | null
          source_type: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
          value_json: Json
          verified_by_user: boolean
        }
        Insert: {
          business_id: string
          confidence?: number
          created_at?: string
          fact_key: string
          id?: string
          last_verified_at?: string | null
          locked?: boolean
          source_id?: string | null
          source_type?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
          value_json?: Json
          verified_by_user?: boolean
        }
        Update: {
          business_id?: string
          confidence?: number
          created_at?: string
          fact_key?: string
          id?: string
          last_verified_at?: string | null
          locked?: boolean
          source_id?: string | null
          source_type?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
          value_json?: Json
          verified_by_user?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "business_memory_facts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_playbooks: {
        Row: {
          business_id: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          notes: string | null
          prohibited_claims: Json
          proof_points: Json
          tone: string | null
          updated_at: string
          value_propositions: Json
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          notes?: string | null
          prohibited_claims?: Json
          proof_points?: Json
          tone?: string | null
          updated_at?: string
          value_propositions?: Json
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          notes?: string | null
          prohibited_claims?: Json
          proof_points?: Json
          tone?: string | null
          updated_at?: string
          value_propositions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "business_playbooks_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_profiles: {
        Row: {
          analysis_error: string | null
          analysis_status: string
          business_id: string
          business_type: string | null
          created_at: string
          id: string
          last_analysed_at: string | null
          pages_analysed: number
          profile_version: number
          sales_model: string | null
          summary: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          analysis_error?: string | null
          analysis_status?: string
          business_id: string
          business_type?: string | null
          created_at?: string
          id?: string
          last_analysed_at?: string | null
          pages_analysed?: number
          profile_version?: number
          sales_model?: string | null
          summary?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          analysis_error?: string | null
          analysis_status?: string
          business_id?: string
          business_type?: string | null
          created_at?: string
          id?: string
          last_analysed_at?: string | null
          pages_analysed?: number
          profile_version?: number
          sales_model?: string | null
          summary?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_profiles_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
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
      campaign_experiments: {
        Row: {
          business_id: string
          campaign_id: string
          concluded_at: string | null
          conclusion: string | null
          dimension: string
          id: string
          minimum_sample_size: number
          name: string
          started_at: string
          status: string
          winning_variant_id: string | null
        }
        Insert: {
          business_id: string
          campaign_id: string
          concluded_at?: string | null
          conclusion?: string | null
          dimension: string
          id?: string
          minimum_sample_size?: number
          name: string
          started_at?: string
          status?: string
          winning_variant_id?: string | null
        }
        Update: {
          business_id?: string
          campaign_id?: string
          concluded_at?: string | null
          conclusion?: string | null
          dimension?: string
          id?: string
          minimum_sample_size?: number
          name?: string
          started_at?: string
          status?: string
          winning_variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_experiments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_experiments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_experiments_winner_fk"
            columns: ["winning_variant_id"]
            isOneToOne: false
            referencedRelation: "campaign_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_learnings: {
        Row: {
          business_id: string
          campaign_id: string | null
          confidence: number
          created_at: string
          dimension: string
          evidence_json: Json
          expires_at: string | null
          finding: string
          id: string
          recommended_action: string | null
          sample_size: number
          status: string
        }
        Insert: {
          business_id: string
          campaign_id?: string | null
          confidence?: number
          created_at?: string
          dimension: string
          evidence_json?: Json
          expires_at?: string | null
          finding: string
          id?: string
          recommended_action?: string | null
          sample_size?: number
          status?: string
        }
        Update: {
          business_id?: string
          campaign_id?: string | null
          confidence?: number
          created_at?: string
          dimension?: string
          evidence_json?: Json
          expires_at?: string | null
          finding?: string
          id?: string
          recommended_action?: string | null
          sample_size?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_learnings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_learnings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_variants: {
        Row: {
          active: boolean
          allocation_percent: number
          bounce_count: number
          business_id: string
          complaint_count: number
          content_json: Json
          conversion_count: number
          created_at: string
          delivered_count: number
          experiment_id: string
          id: string
          label: string
          positive_reply_count: number
          reply_count: number
          sent_count: number
          step_id: string | null
        }
        Insert: {
          active?: boolean
          allocation_percent?: number
          bounce_count?: number
          business_id: string
          complaint_count?: number
          content_json?: Json
          conversion_count?: number
          created_at?: string
          delivered_count?: number
          experiment_id: string
          id?: string
          label: string
          positive_reply_count?: number
          reply_count?: number
          sent_count?: number
          step_id?: string | null
        }
        Update: {
          active?: boolean
          allocation_percent?: number
          bounce_count?: number
          business_id?: string
          complaint_count?: number
          content_json?: Json
          conversion_count?: number
          created_at?: string
          delivered_count?: number
          experiment_id?: string
          id?: string
          label?: string
          positive_reply_count?: number
          reply_count?: number
          sent_count?: number
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_variants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_variants_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "campaign_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_variants_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "outreach_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          ai_personalize: boolean
          audience_label: string | null
          business_id: string
          cancelled_at: string | null
          channel: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          estimated_audience_size: number
          filter_config: Json
          followup_delay_seconds: number | null
          followup_subject_template: string | null
          followup_template: string | null
          id: string
          launched_at: string | null
          launched_by: string | null
          message_template: string | null
          name: string
          paused_at: string | null
          scheduled_at: string | null
          send_rate_per_minute: number
          send_window_end: string
          send_window_start: string
          started_at: string | null
          status: string
          subject_template: string | null
          suppression_summary: Json
          tags: string[]
          timezone: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_personalize?: boolean
          audience_label?: string | null
          business_id: string
          cancelled_at?: string | null
          channel?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_audience_size?: number
          filter_config?: Json
          followup_delay_seconds?: number | null
          followup_subject_template?: string | null
          followup_template?: string | null
          id?: string
          launched_at?: string | null
          launched_by?: string | null
          message_template?: string | null
          name: string
          paused_at?: string | null
          scheduled_at?: string | null
          send_rate_per_minute?: number
          send_window_end?: string
          send_window_start?: string
          started_at?: string | null
          status?: string
          subject_template?: string | null
          suppression_summary?: Json
          tags?: string[]
          timezone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_personalize?: boolean
          audience_label?: string | null
          business_id?: string
          cancelled_at?: string | null
          channel?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_audience_size?: number
          filter_config?: Json
          followup_delay_seconds?: number | null
          followup_subject_template?: string | null
          followup_template?: string | null
          id?: string
          launched_at?: string | null
          launched_by?: string | null
          message_template?: string | null
          name?: string
          paused_at?: string | null
          scheduled_at?: string | null
          send_rate_per_minute?: number
          send_window_end?: string
          send_window_start?: string
          started_at?: string | null
          status?: string
          subject_template?: string | null
          suppression_summary?: Json
          tags?: string[]
          timezone?: string | null
          updated_at?: string
          updated_by?: string | null
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
      compliance_decisions: {
        Row: {
          business_id: string | null
          channel: string | null
          decided_at: string
          decided_by: string | null
          decided_by_admin: boolean
          decision: string
          evidence_json: Json
          id: string
          policy_version: string
          rationale: string | null
          subject_id: string
          subject_type: string
        }
        Insert: {
          business_id?: string | null
          channel?: string | null
          decided_at?: string
          decided_by?: string | null
          decided_by_admin?: boolean
          decision: string
          evidence_json?: Json
          id?: string
          policy_version: string
          rationale?: string | null
          subject_id: string
          subject_type: string
        }
        Update: {
          business_id?: string | null
          channel?: string | null
          decided_at?: string
          decided_by?: string | null
          decided_by_admin?: boolean
          decision?: string
          evidence_json?: Json
          id?: string
          policy_version?: string
          rationale?: string | null
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_decisions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_policy_versions: {
        Row: {
          activated_at: string | null
          channels: string[]
          country_codes: string[]
          created_at: string
          id: string
          name: string
          notes: string | null
          retired_at: string | null
          rules_json: Json
          status: string
          version: string
        }
        Insert: {
          activated_at?: string | null
          channels?: string[]
          country_codes?: string[]
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          retired_at?: string | null
          rules_json?: Json
          status?: string
          version: string
        }
        Update: {
          activated_at?: string | null
          channels?: string[]
          country_codes?: string[]
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          retired_at?: string | null
          rules_json?: Json
          status?: string
          version?: string
        }
        Relationships: []
      }
      contact_permissions: {
        Row: {
          business_id: string
          consent_captured_at: string | null
          consent_evidence: string | null
          consent_scope: Json
          consent_source: string | null
          consent_status: string
          country: string | null
          created_at: string
          email: string | null
          id: string
          lawful_basis_tag: string | null
          phone_e164: string | null
          recorded_by: string | null
          relationship_detail: string | null
          relationship_type: string
          subject_id: string
          subject_type: string
          subscriber_type: string
          updated_at: string
        }
        Insert: {
          business_id: string
          consent_captured_at?: string | null
          consent_evidence?: string | null
          consent_scope?: Json
          consent_source?: string | null
          consent_status?: string
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          lawful_basis_tag?: string | null
          phone_e164?: string | null
          recorded_by?: string | null
          relationship_detail?: string | null
          relationship_type?: string
          subject_id: string
          subject_type: string
          subscriber_type?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          consent_captured_at?: string | null
          consent_evidence?: string | null
          consent_scope?: Json
          consent_source?: string | null
          consent_status?: string
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          lawful_basis_tag?: string | null
          phone_e164?: string | null
          recorded_by?: string | null
          relationship_detail?: string | null
          relationship_type?: string
          subject_id?: string
          subject_type?: string
          subscriber_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_permissions_business_id_fkey"
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
      contactability_results: {
        Row: {
          business_id: string
          campaign_type: string
          channel: string
          country: string | null
          evaluated_at: string
          evidence_json: Json
          id: string
          policy_version: string
          reason_code: string
          relationship_type: string | null
          result: string
          subject_id: string
          subject_type: string
          subscriber_type: string | null
        }
        Insert: {
          business_id: string
          campaign_type?: string
          channel: string
          country?: string | null
          evaluated_at?: string
          evidence_json?: Json
          id?: string
          policy_version: string
          reason_code: string
          relationship_type?: string | null
          result: string
          subject_id: string
          subject_type: string
          subscriber_type?: string | null
        }
        Update: {
          business_id?: string
          campaign_type?: string
          channel?: string
          country?: string | null
          evaluated_at?: string
          evidence_json?: Json
          id?: string
          policy_version?: string
          reason_code?: string
          relationship_type?: string | null
          result?: string
          subject_id?: string
          subject_type?: string
          subscriber_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contactability_results_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_agent_actions: {
        Row: {
          agent_run_id: string
          business_id: string
          created_at: string
          denial_reason: string | null
          id: string
          input_summary: Json
          latency_ms: number | null
          result_summary: Json
          risk_level: string
          status: string
          step_index: number
          tool_name: string
        }
        Insert: {
          agent_run_id: string
          business_id: string
          created_at?: string
          denial_reason?: string | null
          id?: string
          input_summary?: Json
          latency_ms?: number | null
          result_summary?: Json
          risk_level?: string
          status?: string
          step_index?: number
          tool_name: string
        }
        Update: {
          agent_run_id?: string
          business_id?: string
          created_at?: string
          denial_reason?: string | null
          id?: string
          input_summary?: Json
          latency_ms?: number | null
          result_summary?: Json
          risk_level?: string
          status?: string
          step_index?: number
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_agent_actions_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "conversation_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_agent_actions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_agent_extractions: {
        Row: {
          accepted: boolean
          agent_run_id: string
          business_id: string
          confidence: number | null
          created_at: string
          field: string
          id: string
          lead_id: string | null
          rejected_reason: string | null
          source_message_id: string | null
          value_json: Json | null
        }
        Insert: {
          accepted?: boolean
          agent_run_id: string
          business_id: string
          confidence?: number | null
          created_at?: string
          field: string
          id?: string
          lead_id?: string | null
          rejected_reason?: string | null
          source_message_id?: string | null
          value_json?: Json | null
        }
        Update: {
          accepted?: boolean
          agent_run_id?: string
          business_id?: string
          confidence?: number | null
          created_at?: string
          field?: string
          id?: string
          lead_id?: string | null
          rejected_reason?: string | null
          source_message_id?: string | null
          value_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_agent_extractions_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "conversation_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_agent_extractions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_agent_extractions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_agent_extractions_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_agent_runs: {
        Row: {
          agent_mode: string
          business_id: string
          channel: string | null
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          decision_json: Json
          detected_intent: string | null
          duration_ms: number | null
          error_code: string | null
          estimated_cost_usd: number
          id: string
          idempotency_key: string
          input_tokens: number
          intent_confidence: number | null
          lead_id: string | null
          lifecycle_after: string | null
          lifecycle_before: string | null
          mode: string
          model_name: string | null
          model_provider: string | null
          outcome: string | null
          output_tokens: number
          qualification_after: string | null
          qualification_before: string | null
          reply_classification: string | null
          started_at: string
          status: string
          step_count: number
          trigger_event_id: string | null
          trigger_event_type: string
        }
        Insert: {
          agent_mode?: string
          business_id: string
          channel?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          decision_json?: Json
          detected_intent?: string | null
          duration_ms?: number | null
          error_code?: string | null
          estimated_cost_usd?: number
          id?: string
          idempotency_key: string
          input_tokens?: number
          intent_confidence?: number | null
          lead_id?: string | null
          lifecycle_after?: string | null
          lifecycle_before?: string | null
          mode?: string
          model_name?: string | null
          model_provider?: string | null
          outcome?: string | null
          output_tokens?: number
          qualification_after?: string | null
          qualification_before?: string | null
          reply_classification?: string | null
          started_at?: string
          status?: string
          step_count?: number
          trigger_event_id?: string | null
          trigger_event_type: string
        }
        Update: {
          agent_mode?: string
          business_id?: string
          channel?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          decision_json?: Json
          detected_intent?: string | null
          duration_ms?: number | null
          error_code?: string | null
          estimated_cost_usd?: number
          id?: string
          idempotency_key?: string
          input_tokens?: number
          intent_confidence?: number | null
          lead_id?: string | null
          lifecycle_after?: string | null
          lifecycle_before?: string | null
          mode?: string
          model_name?: string | null
          model_provider?: string | null
          outcome?: string | null
          output_tokens?: number
          qualification_after?: string | null
          qualification_before?: string | null
          reply_classification?: string | null
          started_at?: string
          status?: string
          step_count?: number
          trigger_event_id?: string | null
          trigger_event_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_agent_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_agent_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_agent_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_summaries: {
        Row: {
          business_id: string
          conversation_id: string
          last_message_id: string | null
          message_count: number
          summary_json: Json
          updated_at: string
        }
        Insert: {
          business_id: string
          conversation_id: string
          last_message_id?: string | null
          message_count?: number
          summary_json?: Json
          updated_at?: string
        }
        Update: {
          business_id?: string
          conversation_id?: string
          last_message_id?: string | null
          message_count?: number
          summary_json?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_summaries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_summaries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_summaries_last_message_id_fkey"
            columns: ["last_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          agent_locked_until: string | null
          agent_turn_seq: number
          assigned_user_id: string | null
          business_id: string
          channel: string
          counterparty_avatar_url: string | null
          counterparty_handle: string | null
          counterparty_name: string | null
          created_at: string
          current_question_id: string | null
          external_thread_id: string | null
          id: string
          inbox_channel_id: string | null
          is_archived: boolean
          last_inbound_at: string | null
          last_message_at: string | null
          last_outbound_at: string | null
          lead_id: string | null
          owner: string
          owner_changed_at: string | null
          owner_changed_by: string | null
          prospect_id: string | null
          provider_thread_id: string | null
          snoozed_until: string | null
          state: string
          subject: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          agent_locked_until?: string | null
          agent_turn_seq?: number
          assigned_user_id?: string | null
          business_id: string
          channel: string
          counterparty_avatar_url?: string | null
          counterparty_handle?: string | null
          counterparty_name?: string | null
          created_at?: string
          current_question_id?: string | null
          external_thread_id?: string | null
          id?: string
          inbox_channel_id?: string | null
          is_archived?: boolean
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          lead_id?: string | null
          owner?: string
          owner_changed_at?: string | null
          owner_changed_by?: string | null
          prospect_id?: string | null
          provider_thread_id?: string | null
          snoozed_until?: string | null
          state?: string
          subject?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          agent_locked_until?: string | null
          agent_turn_seq?: number
          assigned_user_id?: string | null
          business_id?: string
          channel?: string
          counterparty_avatar_url?: string | null
          counterparty_handle?: string | null
          counterparty_name?: string | null
          created_at?: string
          current_question_id?: string | null
          external_thread_id?: string | null
          id?: string
          inbox_channel_id?: string | null
          is_archived?: boolean
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          lead_id?: string | null
          owner?: string
          owner_changed_at?: string | null
          owner_changed_by?: string | null
          prospect_id?: string | null
          provider_thread_id?: string | null
          snoozed_until?: string | null
          state?: string
          subject?: string | null
          unread_count?: number
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
            foreignKeyName: "conversations_inbox_channel_id_fkey"
            columns: ["inbox_channel_id"]
            isOneToOne: false
            referencedRelation: "inbox_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_goals: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          destination_config: Json
          destination_type: string
          id: string
          is_default: boolean
          name: string
          qualification_required: boolean
          service_scope: Json
          success_event: string
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          destination_config?: Json
          destination_type?: string
          id?: string
          is_default?: boolean
          name: string
          qualification_required?: boolean
          service_scope?: Json
          success_event?: string
          type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          destination_config?: Json
          destination_type?: string
          id?: string
          is_default?: boolean
          name?: string
          qualification_required?: boolean
          service_scope?: Json
          success_event?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversion_goals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_events: {
        Row: {
          agent_run_id: string | null
          business_id: string | null
          campaign_id: string | null
          category: string | null
          currency: string
          estimated: boolean
          id: string
          idempotency_key: string | null
          message_id: string | null
          metadata: Json
          metric: string
          occurred_at: string
          price_book_id: string | null
          product: string | null
          provider: string
          quantity: number
          reconciled: boolean
          source_event_id: string | null
          sourcing_run_id: string | null
          subject_id: string | null
          subject_type: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          agent_run_id?: string | null
          business_id?: string | null
          campaign_id?: string | null
          category?: string | null
          currency?: string
          estimated?: boolean
          id?: string
          idempotency_key?: string | null
          message_id?: string | null
          metadata?: Json
          metric: string
          occurred_at?: string
          price_book_id?: string | null
          product?: string | null
          provider: string
          quantity: number
          reconciled?: boolean
          source_event_id?: string | null
          sourcing_run_id?: string | null
          subject_id?: string | null
          subject_type?: string | null
          total_cost: number
          unit_cost: number
        }
        Update: {
          agent_run_id?: string | null
          business_id?: string | null
          campaign_id?: string | null
          category?: string | null
          currency?: string
          estimated?: boolean
          id?: string
          idempotency_key?: string | null
          message_id?: string | null
          metadata?: Json
          metric?: string
          occurred_at?: string
          price_book_id?: string | null
          product?: string | null
          provider?: string
          quantity?: number
          reconciled?: boolean
          source_event_id?: string | null
          sourcing_run_id?: string | null
          subject_id?: string | null
          subject_type?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "cost_events_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_events_price_book_id_fkey"
            columns: ["price_book_id"]
            isOneToOne: false
            referencedRelation: "provider_price_book"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_events_sourcing_run_id_fkey"
            columns: ["sourcing_run_id"]
            isOneToOne: false
            referencedRelation: "sourcing_runs"
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
      customer_usage_allocations: {
        Row: {
          billing_period: string
          business_id: string
          daily_caps_json: Json
          email_percent: number
          id: string
          overage_cap_minor: number
          overage_enabled: boolean
          sms_percent: number
          updated_at: string
          updated_by: string | null
          whatsapp_percent: number
        }
        Insert: {
          billing_period: string
          business_id: string
          daily_caps_json?: Json
          email_percent?: number
          id?: string
          overage_cap_minor?: number
          overage_enabled?: boolean
          sms_percent?: number
          updated_at?: string
          updated_by?: string | null
          whatsapp_percent?: number
        }
        Update: {
          billing_period?: string
          business_id?: string
          daily_caps_json?: Json
          email_percent?: number
          id?: string
          overage_cap_minor?: number
          overage_enabled?: boolean
          sms_percent?: number
          updated_at?: string
          updated_by?: string | null
          whatsapp_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_usage_allocations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_health_snapshots: {
        Row: {
          bounce_count: number
          bounce_rate: number
          business_id: string
          complaint_count: number
          complaint_rate: number
          created_at: string
          dkim_state: string
          dmarc_policy: string | null
          dmarc_state: string
          domain: string
          health_state: string
          id: string
          sent_count: number
          snapshot_date: string
          spf_state: string
        }
        Insert: {
          bounce_count?: number
          bounce_rate?: number
          business_id: string
          complaint_count?: number
          complaint_rate?: number
          created_at?: string
          dkim_state?: string
          dmarc_policy?: string | null
          dmarc_state?: string
          domain: string
          health_state?: string
          id?: string
          sent_count?: number
          snapshot_date?: string
          spf_state?: string
        }
        Update: {
          bounce_count?: number
          bounce_rate?: number
          business_id?: string
          complaint_count?: number
          complaint_rate?: number
          created_at?: string
          dkim_state?: string
          dmarc_policy?: string | null
          dmarc_state?: string
          domain?: string
          health_state?: string
          id?: string
          sent_count?: number
          snapshot_date?: string
          spf_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_health_snapshots_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      economics_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          business_id: string | null
          created_at: string
          detail: string | null
          id: string
          metrics_json: Json
          resolved_at: string | null
          severity: string
          status: string
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          business_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          metrics_json?: Json
          resolved_at?: string | null
          severity?: string
          status?: string
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          business_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          metrics_json?: Json
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "economics_alerts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      external_connections: {
        Row: {
          account_label: string | null
          business_id: string
          connected_by: string | null
          created_at: string
          external_account_id: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          provider: string
          secret_ref: string | null
          status: string
          status_detail: string | null
          sync_config: Json
          sync_cursor: string | null
          sync_direction: string
          updated_at: string
        }
        Insert: {
          account_label?: string | null
          business_id: string
          connected_by?: string | null
          created_at?: string
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          provider: string
          secret_ref?: string | null
          status?: string
          status_detail?: string | null
          sync_config?: Json
          sync_cursor?: string | null
          sync_direction?: string
          updated_at?: string
        }
        Update: {
          account_label?: string | null
          business_id?: string
          connected_by?: string | null
          created_at?: string
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          provider?: string
          secret_ref?: string | null
          status?: string
          status_detail?: string | null
          sync_config?: Json
          sync_cursor?: string | null
          sync_direction?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_connections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      external_entity_links: {
        Row: {
          business_id: string
          connection_id: string
          created_at: string
          external_id: string
          external_type: string
          external_version: string | null
          id: string
          last_pulled_at: string | null
          last_pushed_at: string | null
          local_id: string
          local_type: string
          local_version: string | null
        }
        Insert: {
          business_id: string
          connection_id: string
          created_at?: string
          external_id: string
          external_type: string
          external_version?: string | null
          id?: string
          last_pulled_at?: string | null
          last_pushed_at?: string | null
          local_id: string
          local_type: string
          local_version?: string | null
        }
        Update: {
          business_id?: string
          connection_id?: string
          created_at?: string
          external_id?: string
          external_type?: string
          external_version?: string | null
          id?: string
          last_pulled_at?: string | null
          last_pushed_at?: string | null
          local_id?: string
          local_type?: string
          local_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_entity_links_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_entity_links_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "external_connections"
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
      icp_profiles: {
        Row: {
          active: boolean
          business_id: string
          company_filters: Json
          created_at: string
          default_intent_category_ids: string[]
          description: string | null
          exclusions: Json
          id: string
          industries: Json
          locations: Json
          name: string
          roles: Json
          source: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          business_id: string
          company_filters?: Json
          created_at?: string
          default_intent_category_ids?: string[]
          description?: string | null
          exclusions?: Json
          id?: string
          industries?: Json
          locations?: Json
          name: string
          roles?: Json
          source?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          business_id?: string
          company_filters?: Json
          created_at?: string
          default_intent_category_ids?: string[]
          description?: string | null
          exclusions?: Json
          id?: string
          industries?: Json
          locations?: Json
          name?: string
          roles?: Json
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "icp_profiles_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      icp_segments: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          criteria_json: Json
          icp_profile_id: string
          id: string
          name: string
          priority: number
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          criteria_json?: Json
          icp_profile_id: string
          id?: string
          name: string
          priority?: number
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          criteria_json?: Json
          icp_profile_id?: string
          id?: string
          name?: string
          priority?: number
        }
        Relationships: [
          {
            foreignKeyName: "icp_segments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "icp_segments_icp_profile_id_fkey"
            columns: ["icp_profile_id"]
            isOneToOne: false
            referencedRelation: "icp_profiles"
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
      inbox_channels: {
        Row: {
          avatar_url: string | null
          business_id: string
          can_read: boolean
          can_send: boolean
          channel: string
          connected_by: string | null
          created_at: string
          display_name: string
          external_account_id: string | null
          handle: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          mailbox_connection_id: string | null
          provider: string
          secret_ref: string | null
          status: string
          status_detail: string | null
          sync_cursor: string | null
          unavailable_reason: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          business_id: string
          can_read?: boolean
          can_send?: boolean
          channel: string
          connected_by?: string | null
          created_at?: string
          display_name: string
          external_account_id?: string | null
          handle?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          mailbox_connection_id?: string | null
          provider: string
          secret_ref?: string | null
          status?: string
          status_detail?: string | null
          sync_cursor?: string | null
          unavailable_reason?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          business_id?: string
          can_read?: boolean
          can_send?: boolean
          channel?: string
          connected_by?: string | null
          created_at?: string
          display_name?: string
          external_account_id?: string | null
          handle?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          mailbox_connection_id?: string | null
          provider?: string
          secret_ref?: string | null
          status?: string
          status_detail?: string | null
          sync_cursor?: string | null
          unavailable_reason?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_channels_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_channels_mailbox_connection_id_fkey"
            columns: ["mailbox_connection_id"]
            isOneToOne: false
            referencedRelation: "mailbox_connections"
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
      intent_categories: {
        Row: {
          active: boolean
          auto_add_to_search: boolean
          business_id: string
          created_at: string
          description: string | null
          freshness_days: number
          icp_scope: Json
          id: string
          is_platform_template: boolean
          keywords_entities: Json
          name: string
          score_impact: number
          signal_types: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          auto_add_to_search?: boolean
          business_id: string
          created_at?: string
          description?: string | null
          freshness_days?: number
          icp_scope?: Json
          id?: string
          is_platform_template?: boolean
          keywords_entities?: Json
          name: string
          score_impact?: number
          signal_types?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          auto_add_to_search?: boolean
          business_id?: string
          created_at?: string
          description?: string | null
          freshness_days?: number
          icp_scope?: Json
          id?: string
          is_platform_template?: boolean
          keywords_entities?: Json
          name?: string
          score_impact?: number
          signal_types?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intent_categories_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      intent_events: {
        Row: {
          agent_run_id: string | null
          business_id: string
          company_id: string | null
          confidence: number
          cost_minor: number
          created_at: string
          dedupe_key: string
          evidence_summary: string | null
          expires_at: string
          id: string
          intent_category_id: string
          lead_id: string | null
          monitor_id: string | null
          observed_at: string
          prospect_id: string | null
          score_impact: number
          signal_type: string
          source: string
          source_url: string | null
        }
        Insert: {
          agent_run_id?: string | null
          business_id: string
          company_id?: string | null
          confidence?: number
          cost_minor?: number
          created_at?: string
          dedupe_key: string
          evidence_summary?: string | null
          expires_at: string
          id?: string
          intent_category_id: string
          lead_id?: string | null
          monitor_id?: string | null
          observed_at?: string
          prospect_id?: string | null
          score_impact?: number
          signal_type: string
          source: string
          source_url?: string | null
        }
        Update: {
          agent_run_id?: string | null
          business_id?: string
          company_id?: string | null
          confidence?: number
          cost_minor?: number
          created_at?: string
          dedupe_key?: string
          evidence_summary?: string | null
          expires_at?: string
          id?: string
          intent_category_id?: string
          lead_id?: string | null
          monitor_id?: string | null
          observed_at?: string
          prospect_id?: string | null
          score_impact?: number
          signal_type?: string
          source?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intent_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intent_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "prospect_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intent_events_intent_category_id_fkey"
            columns: ["intent_category_id"]
            isOneToOne: false
            referencedRelation: "intent_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intent_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intent_events_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "intent_monitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intent_events_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      intent_monitors: {
        Row: {
          business_id: string
          cadence: string
          created_at: string
          events_last_period: number
          id: string
          intent_category_id: string
          last_error: string | null
          last_run_at: string | null
          monitor_type: string
          monthly_budget_minor: number
          name: string | null
          next_run_at: string | null
          period_started_on: string | null
          spent_this_period_minor: number
          status: string
          target_json: Json
          updated_at: string
        }
        Insert: {
          business_id: string
          cadence?: string
          created_at?: string
          events_last_period?: number
          id?: string
          intent_category_id: string
          last_error?: string | null
          last_run_at?: string | null
          monitor_type?: string
          monthly_budget_minor?: number
          name?: string | null
          next_run_at?: string | null
          period_started_on?: string | null
          spent_this_period_minor?: number
          status?: string
          target_json?: Json
          updated_at?: string
        }
        Update: {
          business_id?: string
          cadence?: string
          created_at?: string
          events_last_period?: number
          id?: string
          intent_category_id?: string
          last_error?: string | null
          last_run_at?: string | null
          monitor_type?: string
          monthly_budget_minor?: number
          name?: string | null
          next_run_at?: string | null
          period_started_on?: string | null
          spent_this_period_minor?: number
          status?: string
          target_json?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intent_monitors_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intent_monitors_intent_category_id_fkey"
            columns: ["intent_category_id"]
            isOneToOne: false
            referencedRelation: "intent_categories"
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
      lead_import_mappings: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          last_used_at: string | null
          mapping_json: Json
          name: string
          source_signature: string | null
          updated_at: string
          use_count: number
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_used_at?: string | null
          mapping_json?: Json
          name: string
          source_signature?: string | null
          updated_at?: string
          use_count?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_used_at?: string | null
          mapping_json?: Json
          name?: string
          source_signature?: string | null
          updated_at?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_import_mappings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_import_rows: {
        Row: {
          business_id: string
          classification: string
          classification_reason: string | null
          company_name: string | null
          created_at: string
          created_lead_id: string | null
          created_prospect_id: string | null
          duplicate_of_lead_id: string | null
          duplicate_of_prospect_id: string | null
          email: string | null
          error_message: string | null
          first_name: string | null
          id: string
          import_id: string
          import_state: string
          last_name: string | null
          notes: string | null
          phone_e164: string | null
          postcode: string | null
          raw_json: Json
          relationship_type: string | null
          role_title: string | null
          row_number: number
          source_detail: string | null
          user_classification: string | null
          validation_flags: string[]
        }
        Insert: {
          business_id: string
          classification?: string
          classification_reason?: string | null
          company_name?: string | null
          created_at?: string
          created_lead_id?: string | null
          created_prospect_id?: string | null
          duplicate_of_lead_id?: string | null
          duplicate_of_prospect_id?: string | null
          email?: string | null
          error_message?: string | null
          first_name?: string | null
          id?: string
          import_id: string
          import_state?: string
          last_name?: string | null
          notes?: string | null
          phone_e164?: string | null
          postcode?: string | null
          raw_json?: Json
          relationship_type?: string | null
          role_title?: string | null
          row_number: number
          source_detail?: string | null
          user_classification?: string | null
          validation_flags?: string[]
        }
        Update: {
          business_id?: string
          classification?: string
          classification_reason?: string | null
          company_name?: string | null
          created_at?: string
          created_lead_id?: string | null
          created_prospect_id?: string | null
          duplicate_of_lead_id?: string | null
          duplicate_of_prospect_id?: string | null
          email?: string | null
          error_message?: string | null
          first_name?: string | null
          id?: string
          import_id?: string
          import_state?: string
          last_name?: string | null
          notes?: string | null
          phone_e164?: string | null
          postcode?: string | null
          raw_json?: Json
          relationship_type?: string | null
          role_title?: string | null
          row_number?: number
          source_detail?: string | null
          user_classification?: string | null
          validation_flags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "lead_import_rows_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_import_rows_created_lead_id_fkey"
            columns: ["created_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_import_rows_created_prospect_id_fkey"
            columns: ["created_prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_import_rows_duplicate_of_lead_id_fkey"
            columns: ["duplicate_of_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_import_rows_duplicate_of_prospect_id_fkey"
            columns: ["duplicate_of_prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "lead_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_imports: {
        Row: {
          business_id: string
          completed_at: string | null
          content_type: string | null
          created_at: string
          created_by: string | null
          default_conversion_goal_id: string | null
          default_relationship_type: string | null
          default_service_id: string | null
          default_source_detail: string | null
          delimiter: string | null
          encoding: string
          error_message: string | null
          failed_row_count: number
          file_key: string | null
          file_size_bytes: number
          filename: string
          id: string
          imported_lead_count: number
          imported_prospect_count: number
          lead_rows: number
          mapping_json: Json
          prospect_rows: number
          review_rows: number
          skip_rows: number
          start_follow_up: boolean
          started_at: string | null
          status: string
          total_rows: number
          updated_at: string
          valid_rows: number
        }
        Insert: {
          business_id: string
          completed_at?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          default_conversion_goal_id?: string | null
          default_relationship_type?: string | null
          default_service_id?: string | null
          default_source_detail?: string | null
          delimiter?: string | null
          encoding?: string
          error_message?: string | null
          failed_row_count?: number
          file_key?: string | null
          file_size_bytes?: number
          filename: string
          id?: string
          imported_lead_count?: number
          imported_prospect_count?: number
          lead_rows?: number
          mapping_json?: Json
          prospect_rows?: number
          review_rows?: number
          skip_rows?: number
          start_follow_up?: boolean
          started_at?: string | null
          status?: string
          total_rows?: number
          updated_at?: string
          valid_rows?: number
        }
        Update: {
          business_id?: string
          completed_at?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          default_conversion_goal_id?: string | null
          default_relationship_type?: string | null
          default_service_id?: string | null
          default_source_detail?: string | null
          delimiter?: string | null
          encoding?: string
          error_message?: string | null
          failed_row_count?: number
          file_key?: string | null
          file_size_bytes?: number
          filename?: string
          id?: string
          imported_lead_count?: number
          imported_prospect_count?: number
          lead_rows?: number
          mapping_json?: Json
          prospect_rows?: number
          review_rows?: number
          skip_rows?: number
          start_follow_up?: boolean
          started_at?: string | null
          status?: string
          total_rows?: number
          updated_at?: string
          valid_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_imports_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_imports_default_conversion_goal_id_fkey"
            columns: ["default_conversion_goal_id"]
            isOneToOne: false
            referencedRelation: "conversion_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_imports_default_service_id_fkey"
            columns: ["default_service_id"]
            isOneToOne: false
            referencedRelation: "services"
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
      lead_source_evidence: {
        Row: {
          business_id: string
          campaign_id: string | null
          captured_by: string | null
          consent_evidence: string | null
          created_at: string
          evidence_json: Json
          id: string
          import_id: string | null
          intake_method: string
          relationship_type: string | null
          source_detail: string | null
          sourcing_run_id: string | null
          subject_id: string
          subject_type: string
        }
        Insert: {
          business_id: string
          campaign_id?: string | null
          captured_by?: string | null
          consent_evidence?: string | null
          created_at?: string
          evidence_json?: Json
          id?: string
          import_id?: string | null
          intake_method: string
          relationship_type?: string | null
          source_detail?: string | null
          sourcing_run_id?: string | null
          subject_id: string
          subject_type: string
        }
        Update: {
          business_id?: string
          campaign_id?: string | null
          captured_by?: string | null
          consent_evidence?: string | null
          created_at?: string
          evidence_json?: Json
          id?: string
          import_id?: string | null
          intake_method?: string
          relationship_type?: string | null
          source_detail?: string | null
          sourcing_run_id?: string | null
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_source_evidence_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_source_evidence_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_source_evidence_import_fk"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "lead_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_source_evidence_sourcing_run_id_fkey"
            columns: ["sourcing_run_id"]
            isOneToOne: false
            referencedRelation: "sourcing_runs"
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
          agent_id: string | null
          assigned_user_id: string | null
          attention_reason: string | null
          automation_active: boolean
          booked_at: string | null
          business_id: string
          company_name: string | null
          conversion_goal_id: string | null
          conversion_goal_type: string | null
          created_at: string
          created_by_user_id: string | null
          created_via: string | null
          email: string | null
          estimated_value: number | null
          external_id: string | null
          first_contacted_at: string | null
          first_name: string | null
          first_replied_at: string | null
          human_takeover: boolean
          id: string
          intake_detail: string | null
          intake_method: string | null
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
          promoted_at: string | null
          promoted_from_prospect_id: string | null
          qualification_reason: Json
          qualification_state: string
          qualified_at: string | null
          relationship_type: string | null
          service_id: string | null
          source_campaign_id: string | null
          source_id: string | null
          sourcing_run_id: string | null
          status: string
          subscriber_type: string | null
          telephone: string | null
          unsubscribe_token: string
          updated_at: string
          won_at: string | null
        }
        Insert: {
          agent_id?: string | null
          assigned_user_id?: string | null
          attention_reason?: string | null
          automation_active?: boolean
          booked_at?: string | null
          business_id: string
          company_name?: string | null
          conversion_goal_id?: string | null
          conversion_goal_type?: string | null
          created_at?: string
          created_by_user_id?: string | null
          created_via?: string | null
          email?: string | null
          estimated_value?: number | null
          external_id?: string | null
          first_contacted_at?: string | null
          first_name?: string | null
          first_replied_at?: string | null
          human_takeover?: boolean
          id?: string
          intake_detail?: string | null
          intake_method?: string | null
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
          promoted_at?: string | null
          promoted_from_prospect_id?: string | null
          qualification_reason?: Json
          qualification_state?: string
          qualified_at?: string | null
          relationship_type?: string | null
          service_id?: string | null
          source_campaign_id?: string | null
          source_id?: string | null
          sourcing_run_id?: string | null
          status?: string
          subscriber_type?: string | null
          telephone?: string | null
          unsubscribe_token?: string
          updated_at?: string
          won_at?: string | null
        }
        Update: {
          agent_id?: string | null
          assigned_user_id?: string | null
          attention_reason?: string | null
          automation_active?: boolean
          booked_at?: string | null
          business_id?: string
          company_name?: string | null
          conversion_goal_id?: string | null
          conversion_goal_type?: string | null
          created_at?: string
          created_by_user_id?: string | null
          created_via?: string | null
          email?: string | null
          estimated_value?: number | null
          external_id?: string | null
          first_contacted_at?: string | null
          first_name?: string | null
          first_replied_at?: string | null
          human_takeover?: boolean
          id?: string
          intake_detail?: string | null
          intake_method?: string | null
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
          promoted_at?: string | null
          promoted_from_prospect_id?: string | null
          qualification_reason?: Json
          qualification_state?: string
          qualified_at?: string | null
          relationship_type?: string | null
          service_id?: string | null
          source_campaign_id?: string | null
          source_id?: string | null
          sourcing_run_id?: string | null
          status?: string
          subscriber_type?: string | null
          telephone?: string | null
          unsubscribe_token?: string
          updated_at?: string
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_conversion_goal_id_fkey"
            columns: ["conversion_goal_id"]
            isOneToOne: false
            referencedRelation: "conversion_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_promoted_from_prospect_id_fkey"
            columns: ["promoted_from_prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
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
            foreignKeyName: "leads_source_campaign_id_fkey"
            columns: ["source_campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "lead_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_sourcing_run_id_fkey"
            columns: ["sourcing_run_id"]
            isOneToOne: false
            referencedRelation: "sourcing_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      mailbox_connections: {
        Row: {
          account_email: string
          business_id: string
          connected_by: string | null
          created_at: string
          display_name: string | null
          id: string
          last_error: string | null
          last_send_at: string | null
          last_sync_at: string | null
          provider: string
          scopes: string[]
          secret_ref: string | null
          status: string
          status_detail: string | null
          sync_cursor: string | null
          sync_enabled: boolean
          updated_at: string
        }
        Insert: {
          account_email: string
          business_id: string
          connected_by?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_error?: string | null
          last_send_at?: string | null
          last_sync_at?: string | null
          provider: string
          scopes?: string[]
          secret_ref?: string | null
          status?: string
          status_detail?: string | null
          sync_cursor?: string | null
          sync_enabled?: boolean
          updated_at?: string
        }
        Update: {
          account_email?: string
          business_id?: string
          connected_by?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_error?: string | null
          last_send_at?: string | null
          last_sync_at?: string | null
          provider?: string
          scopes?: string[]
          secret_ref?: string | null
          status?: string
          status_detail?: string | null
          sync_cursor?: string | null
          sync_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailbox_connections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      mailbox_health_snapshots: {
        Row: {
          bounce_count: number
          business_id: string
          complaint_count: number
          connection_state: string
          created_at: string
          health_state: string
          id: string
          mailbox_connection_id: string
          reply_count: number
          sent_count: number
          snapshot_date: string
          sync_lag_seconds: number | null
          throttled_count: number
        }
        Insert: {
          bounce_count?: number
          business_id: string
          complaint_count?: number
          connection_state?: string
          created_at?: string
          health_state?: string
          id?: string
          mailbox_connection_id: string
          reply_count?: number
          sent_count?: number
          snapshot_date?: string
          sync_lag_seconds?: number | null
          throttled_count?: number
        }
        Update: {
          bounce_count?: number
          business_id?: string
          complaint_count?: number
          connection_state?: string
          created_at?: string
          health_state?: string
          id?: string
          mailbox_connection_id?: string
          reply_count?: number
          sent_count?: number
          snapshot_date?: string
          sync_lag_seconds?: number | null
          throttled_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "mailbox_health_snapshots_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailbox_health_snapshots_mailbox_connection_id_fkey"
            columns: ["mailbox_connection_id"]
            isOneToOne: false
            referencedRelation: "mailbox_connections"
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
      mcp_approvals: {
        Row: {
          arguments_json: Json
          business_id: string
          client_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          executed_at: string | null
          execution_error: string | null
          expires_at: string
          id: string
          requested_by_user_id: string | null
          status: string
          summary: string
          tool_name: string
        }
        Insert: {
          arguments_json?: Json
          business_id: string
          client_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          executed_at?: string | null
          execution_error?: string | null
          expires_at?: string
          id?: string
          requested_by_user_id?: string | null
          status?: string
          summary: string
          tool_name: string
        }
        Update: {
          arguments_json?: Json
          business_id?: string
          client_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          executed_at?: string | null
          execution_error?: string | null
          expires_at?: string
          id?: string
          requested_by_user_id?: string | null
          status?: string
          summary?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_approvals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_approvals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "mcp_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_audit_logs: {
        Row: {
          approval_id: string | null
          arguments_json: Json
          business_id: string | null
          client_id: string | null
          created_at: string
          denial_reason: string | null
          id: string
          latency_ms: number | null
          result: string
          tool_kind: string
          tool_name: string
          user_id: string | null
        }
        Insert: {
          approval_id?: string | null
          arguments_json?: Json
          business_id?: string | null
          client_id?: string | null
          created_at?: string
          denial_reason?: string | null
          id?: string
          latency_ms?: number | null
          result?: string
          tool_kind?: string
          tool_name: string
          user_id?: string | null
        }
        Update: {
          approval_id?: string | null
          arguments_json?: Json
          business_id?: string | null
          client_id?: string | null
          created_at?: string
          denial_reason?: string | null
          id?: string
          latency_ms?: number | null
          result?: string
          tool_kind?: string
          tool_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_audit_logs_approval_fk"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "mcp_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_audit_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_audit_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "mcp_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_clients: {
        Row: {
          business_id: string
          client_secret_hash: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          last_used_at: string | null
          name: string
          oauth_client_id: string
          redirect_uris: string[]
          revoked_at: string | null
          revoked_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          client_secret_hash?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          oauth_client_id: string
          redirect_uris?: string[]
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          client_secret_hash?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          oauth_client_id?: string
          redirect_uris?: string[]
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_clients_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_scopes: {
        Row: {
          business_id: string
          client_id: string
          granted_at: string
          granted_by: string | null
          id: string
          revoked_at: string | null
          scope: string
          tool_name: string | null
        }
        Insert: {
          business_id: string
          client_id: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          scope: string
          tool_name?: string | null
        }
        Update: {
          business_id?: string
          client_id?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          scope?: string
          tool_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_scopes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_scopes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "mcp_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_tokens: {
        Row: {
          business_id: string
          client_id: string
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          revoked_at: string | null
          scopes: string[]
          token_hash: string
          token_type: string
          user_id: string
        }
        Insert: {
          business_id: string
          client_id: string
          created_at?: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          token_hash: string
          token_type?: string
          user_id: string
        }
        Update: {
          business_id?: string
          client_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
          token_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_tokens_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "mcp_clients"
            referencedColumns: ["id"]
          },
        ]
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
          agent_run_id: string | null
          attachments: Json
          automation_run_id: string | null
          body: string
          bounced_at: string | null
          business_id: string
          campaign_id: string | null
          channel: string
          complained_at: string | null
          conversation_id: string
          cost_amount: number | null
          cost_currency: string | null
          created_at: string
          delivered_at: string | null
          direction: string
          error_code: string | null
          error_message: string | null
          external_message_id: string | null
          failed_at: string | null
          id: string
          in_reply_to_header: string | null
          inbox_channel_id: string | null
          lead_id: string | null
          message_id_header: string | null
          opened_at: string | null
          origin: string
          outreach_step_id: string | null
          prospect_id: string | null
          provider: string | null
          provider_message_id: string | null
          provider_thread_id: string | null
          read_at: string | null
          received_at: string | null
          references_header: string | null
          reply_classification: string | null
          reply_confidence: number | null
          scheduled_for: string | null
          send_key: string | null
          sender_handle: string | null
          sender_identity_id: string | null
          sender_name: string | null
          sent_at: string | null
          status: string
          subject: string | null
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          agent_run_id?: string | null
          attachments?: Json
          automation_run_id?: string | null
          body: string
          bounced_at?: string | null
          business_id: string
          campaign_id?: string | null
          channel: string
          complained_at?: string | null
          conversation_id: string
          cost_amount?: number | null
          cost_currency?: string | null
          created_at?: string
          delivered_at?: string | null
          direction: string
          error_code?: string | null
          error_message?: string | null
          external_message_id?: string | null
          failed_at?: string | null
          id?: string
          in_reply_to_header?: string | null
          inbox_channel_id?: string | null
          lead_id?: string | null
          message_id_header?: string | null
          opened_at?: string | null
          origin?: string
          outreach_step_id?: string | null
          prospect_id?: string | null
          provider?: string | null
          provider_message_id?: string | null
          provider_thread_id?: string | null
          read_at?: string | null
          received_at?: string | null
          references_header?: string | null
          reply_classification?: string | null
          reply_confidence?: number | null
          scheduled_for?: string | null
          send_key?: string | null
          sender_handle?: string | null
          sender_identity_id?: string | null
          sender_name?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          agent_run_id?: string | null
          attachments?: Json
          automation_run_id?: string | null
          body?: string
          bounced_at?: string | null
          business_id?: string
          campaign_id?: string | null
          channel?: string
          complained_at?: string | null
          conversation_id?: string
          cost_amount?: number | null
          cost_currency?: string | null
          created_at?: string
          delivered_at?: string | null
          direction?: string
          error_code?: string | null
          error_message?: string | null
          external_message_id?: string | null
          failed_at?: string | null
          id?: string
          in_reply_to_header?: string | null
          inbox_channel_id?: string | null
          lead_id?: string | null
          message_id_header?: string | null
          opened_at?: string | null
          origin?: string
          outreach_step_id?: string | null
          prospect_id?: string | null
          provider?: string | null
          provider_message_id?: string | null
          provider_thread_id?: string | null
          read_at?: string | null
          received_at?: string | null
          references_header?: string | null
          reply_classification?: string | null
          reply_confidence?: number | null
          scheduled_for?: string | null
          send_key?: string | null
          sender_handle?: string | null
          sender_identity_id?: string | null
          sender_name?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
          variant_id?: string | null
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
            foreignKeyName: "messages_inbox_channel_id_fkey"
            columns: ["inbox_channel_id"]
            isOneToOne: false
            referencedRelation: "inbox_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_outreach_step_id_fkey"
            columns: ["outreach_step_id"]
            isOneToOne: false
            referencedRelation: "outreach_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_identity_id_fkey"
            columns: ["sender_identity_id"]
            isOneToOne: false
            referencedRelation: "sender_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "campaign_variants"
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
      optimization_actions: {
        Row: {
          action_type: string
          after_json: Json
          agent_run_id: string | null
          applied: boolean
          applied_at: string | null
          before_json: Json
          bound_json: Json
          business_id: string
          campaign_id: string | null
          created_at: string
          id: string
          rationale: string | null
          reverted_at: string | null
        }
        Insert: {
          action_type: string
          after_json?: Json
          agent_run_id?: string | null
          applied?: boolean
          applied_at?: string | null
          before_json?: Json
          bound_json?: Json
          business_id: string
          campaign_id?: string | null
          created_at?: string
          id?: string
          rationale?: string | null
          reverted_at?: string | null
        }
        Update: {
          action_type?: string
          after_json?: Json
          agent_run_id?: string | null
          applied?: boolean
          applied_at?: string | null
          before_json?: Json
          bound_json?: Json
          business_id?: string
          campaign_id?: string | null
          created_at?: string
          id?: string
          rationale?: string | null
          reverted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "optimization_actions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "optimization_actions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_campaign_versions: {
        Row: {
          business_id: string
          campaign_id: string
          change_summary: string | null
          changed_by: string
          changed_by_user_id: string | null
          created_at: string
          id: string
          snapshot_json: Json
          version: number
        }
        Insert: {
          business_id: string
          campaign_id: string
          change_summary?: string | null
          changed_by?: string
          changed_by_user_id?: string | null
          created_at?: string
          id?: string
          snapshot_json?: Json
          version: number
        }
        Update: {
          business_id?: string
          campaign_id?: string
          change_summary?: string | null
          changed_by?: string
          changed_by_user_id?: string | null
          created_at?: string
          id?: string
          snapshot_json?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_campaign_versions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_campaign_versions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_campaigns: {
        Row: {
          active_sequence_id: string | null
          audience_json: Json
          auto_optimize: boolean
          auto_overage: boolean
          business_id: string
          completed_at: string | null
          conversion_goal_id: string | null
          created_at: string
          created_by: string | null
          daily_contact_cap: number
          description: string | null
          icp_profile_id: string | null
          id: string
          intent_filter_json: Json
          intent_required: boolean
          launch_validated_at: string | null
          launched_at: string | null
          launched_by: string | null
          max_cost_minor: number
          max_intent_age_days: number | null
          minimum_grade: string
          monthly_contact_cap: number
          name: string
          paused_at: string | null
          priority: number
          prospects_per_run: number
          reserved_allowance_minor: number
          review_before_outreach: boolean
          sender_identity_id: string | null
          service_id: string | null
          spent_cost_minor: number
          status: string
          stopped_at: string | null
          updated_at: string
        }
        Insert: {
          active_sequence_id?: string | null
          audience_json?: Json
          auto_optimize?: boolean
          auto_overage?: boolean
          business_id: string
          completed_at?: string | null
          conversion_goal_id?: string | null
          created_at?: string
          created_by?: string | null
          daily_contact_cap?: number
          description?: string | null
          icp_profile_id?: string | null
          id?: string
          intent_filter_json?: Json
          intent_required?: boolean
          launch_validated_at?: string | null
          launched_at?: string | null
          launched_by?: string | null
          max_cost_minor?: number
          max_intent_age_days?: number | null
          minimum_grade?: string
          monthly_contact_cap?: number
          name: string
          paused_at?: string | null
          priority?: number
          prospects_per_run?: number
          reserved_allowance_minor?: number
          review_before_outreach?: boolean
          sender_identity_id?: string | null
          service_id?: string | null
          spent_cost_minor?: number
          status?: string
          stopped_at?: string | null
          updated_at?: string
        }
        Update: {
          active_sequence_id?: string | null
          audience_json?: Json
          auto_optimize?: boolean
          auto_overage?: boolean
          business_id?: string
          completed_at?: string | null
          conversion_goal_id?: string | null
          created_at?: string
          created_by?: string | null
          daily_contact_cap?: number
          description?: string | null
          icp_profile_id?: string | null
          id?: string
          intent_filter_json?: Json
          intent_required?: boolean
          launch_validated_at?: string | null
          launched_at?: string | null
          launched_by?: string | null
          max_cost_minor?: number
          max_intent_age_days?: number | null
          minimum_grade?: string
          monthly_contact_cap?: number
          name?: string
          paused_at?: string | null
          priority?: number
          prospects_per_run?: number
          reserved_allowance_minor?: number
          review_before_outreach?: boolean
          sender_identity_id?: string | null
          service_id?: string | null
          spent_cost_minor?: number
          status?: string
          stopped_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_campaigns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_campaigns_conversion_goal_id_fkey"
            columns: ["conversion_goal_id"]
            isOneToOne: false
            referencedRelation: "conversion_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_campaigns_icp_profile_id_fkey"
            columns: ["icp_profile_id"]
            isOneToOne: false
            referencedRelation: "icp_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_campaigns_sender_fk"
            columns: ["sender_identity_id"]
            isOneToOne: false
            referencedRelation: "sender_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_campaigns_sequence_fk"
            columns: ["active_sequence_id"]
            isOneToOne: false
            referencedRelation: "outreach_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_campaigns_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_recipient_runs: {
        Row: {
          bounced_at: string | null
          business_id: string
          campaign_id: string
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          current_step_position: number
          id: string
          last_sent_at: string | null
          next_step_due_at: string | null
          prospect_id: string
          replied_at: string | null
          sequence_id: string
          status: string
          steps_sent: number
          stop_reason: string | null
          stopped_at: string | null
          updated_at: string
        }
        Insert: {
          bounced_at?: string | null
          business_id: string
          campaign_id: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          current_step_position?: number
          id?: string
          last_sent_at?: string | null
          next_step_due_at?: string | null
          prospect_id: string
          replied_at?: string | null
          sequence_id: string
          status?: string
          steps_sent?: number
          stop_reason?: string | null
          stopped_at?: string | null
          updated_at?: string
        }
        Update: {
          bounced_at?: string | null
          business_id?: string
          campaign_id?: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          current_step_position?: number
          id?: string
          last_sent_at?: string | null
          next_step_due_at?: string | null
          prospect_id?: string
          replied_at?: string | null
          sequence_id?: string
          status?: string
          steps_sent?: number
          stop_reason?: string | null
          stopped_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_recipient_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_recipient_runs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_recipient_runs_conversation_fk"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_recipient_runs_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_recipient_runs_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "outreach_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_runs: {
        Row: {
          business_id: string
          campaign_id: string
          completed_at: string | null
          contacts_attempted: number
          contacts_blocked: number
          contacts_sent: number
          cost_minor: number
          id: string
          run_date: string
          sequence_id: string | null
          started_at: string
          status: string
          stop_reason: string | null
        }
        Insert: {
          business_id: string
          campaign_id: string
          completed_at?: string | null
          contacts_attempted?: number
          contacts_blocked?: number
          contacts_sent?: number
          cost_minor?: number
          id?: string
          run_date?: string
          sequence_id?: string | null
          started_at?: string
          status?: string
          stop_reason?: string | null
        }
        Update: {
          business_id?: string
          campaign_id?: string
          completed_at?: string | null
          contacts_attempted?: number
          contacts_blocked?: number
          contacts_sent?: number
          cost_minor?: number
          id?: string
          run_date?: string
          sequence_id?: string | null
          started_at?: string
          status?: string
          stop_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_runs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_runs_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "outreach_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_sequences: {
        Row: {
          business_id: string
          campaign_id: string
          created_at: string
          id: string
          published_at: string | null
          status: string
          version: number
        }
        Insert: {
          business_id: string
          campaign_id: string
          created_at?: string
          id?: string
          published_at?: string | null
          status?: string
          version?: number
        }
        Update: {
          business_id?: string
          campaign_id?: string
          created_at?: string
          id?: string
          published_at?: string | null
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_sequences_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_sequences_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_steps: {
        Row: {
          body_template: string
          business_id: string
          channel: string
          created_at: string
          delay_seconds: number
          enabled: boolean
          id: string
          position: number
          sequence_id: string
          subject_template: string | null
        }
        Insert: {
          body_template: string
          business_id: string
          channel?: string
          created_at?: string
          delay_seconds?: number
          enabled?: boolean
          id?: string
          position: number
          sequence_id: string
          subject_template?: string | null
        }
        Update: {
          body_template?: string
          business_id?: string
          channel?: string
          created_at?: string
          delay_seconds?: number
          enabled?: boolean
          id?: string
          position?: number
          sequence_id?: string
          subject_template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_steps_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "outreach_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_entitlements: {
        Row: {
          boolean_value: boolean | null
          created_at: string
          description: string | null
          hard_limit: number | null
          id: string
          metric: string
          overage_allowed: boolean
          overage_price: number | null
          plan_key: string
          soft_limit: number | null
          text_value: string | null
          unit: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          boolean_value?: boolean | null
          created_at?: string
          description?: string | null
          hard_limit?: number | null
          id?: string
          metric: string
          overage_allowed?: boolean
          overage_price?: number | null
          plan_key: string
          soft_limit?: number | null
          text_value?: string | null
          unit?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          boolean_value?: boolean | null
          created_at?: string
          description?: string | null
          hard_limit?: number | null
          id?: string
          metric?: string
          overage_allowed?: boolean
          overage_price?: number | null
          plan_key?: string
          soft_limit?: number | null
          text_value?: string | null
          unit?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      platform_error_triage: {
        Row: {
          area: string
          business_id: string | null
          created_at: string
          fingerprint: string
          note: string | null
          reference: string
          resolved_at: string | null
          resolved_by: string | null
          sentry_issue_url: string | null
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          area: string
          business_id?: string | null
          created_at?: string
          fingerprint: string
          note?: string | null
          reference: string
          resolved_at?: string | null
          resolved_by?: string | null
          sentry_issue_url?: string | null
          severity: string
          status?: string
          updated_at?: string
        }
        Update: {
          area?: string
          business_id?: string | null
          created_at?: string
          fingerprint?: string
          note?: string | null
          reference?: string
          resolved_at?: string | null
          resolved_by?: string | null
          sentry_issue_url?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_error_triage_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_provider_checks: {
        Row: {
          checked_at: string
          error_code: string | null
          id: string
          latency_ms: number | null
          provider: string
          status: string
        }
        Insert: {
          checked_at?: string
          error_code?: string | null
          id?: string
          latency_ms?: number | null
          provider: string
          status: string
        }
        Update: {
          checked_at?: string
          error_code?: string | null
          id?: string
          latency_ms?: number | null
          provider?: string
          status?: string
        }
        Relationships: []
      }
      privacy_notice_events: {
        Row: {
          business_id: string
          channel: string
          delivered_at: string
          id: string
          message_id: string | null
          notice_version: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          business_id: string
          channel: string
          delivered_at?: string
          id?: string
          message_id?: string | null
          notice_version: string
          subject_id: string
          subject_type: string
        }
        Update: {
          business_id?: string
          channel?: string
          delivered_at?: string
          id?: string
          message_id?: string | null
          notice_version?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "privacy_notice_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "privacy_notice_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
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
      prospect_companies: {
        Row: {
          business_id: string
          company_size: string | null
          created_at: string
          dedupe_key: string
          description: string | null
          domain: string | null
          employee_count: number | null
          excluded: boolean
          exclusion_reason: string | null
          external_ids: Json
          id: string
          industry: string | null
          is_existing_customer: boolean
          location_json: Json
          name: string
          registration_id: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          business_id: string
          company_size?: string | null
          created_at?: string
          dedupe_key: string
          description?: string | null
          domain?: string | null
          employee_count?: number | null
          excluded?: boolean
          exclusion_reason?: string | null
          external_ids?: Json
          id?: string
          industry?: string | null
          is_existing_customer?: boolean
          location_json?: Json
          name: string
          registration_id?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          business_id?: string
          company_size?: string | null
          created_at?: string
          dedupe_key?: string
          description?: string | null
          domain?: string | null
          employee_count?: number | null
          excluded?: boolean
          exclusion_reason?: string | null
          external_ids?: Json
          id?: string
          industry?: string | null
          is_existing_customer?: boolean
          location_json?: Json
          name?: string
          registration_id?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospect_companies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_data_sources: {
        Row: {
          business_id: string
          company_id: string | null
          confidence: number
          cost_minor: number
          field_name: string
          id: string
          obtained_at: string
          policy_tags: Json
          prospect_id: string | null
          provider: string
          provider_entity_id: string | null
          source_type: string
          source_url: string | null
          value_json: Json
          verified_at: string | null
        }
        Insert: {
          business_id: string
          company_id?: string | null
          confidence?: number
          cost_minor?: number
          field_name: string
          id?: string
          obtained_at?: string
          policy_tags?: Json
          prospect_id?: string | null
          provider: string
          provider_entity_id?: string | null
          source_type: string
          source_url?: string | null
          value_json?: Json
          verified_at?: string | null
        }
        Update: {
          business_id?: string
          company_id?: string | null
          confidence?: number
          cost_minor?: number
          field_name?: string
          id?: string
          obtained_at?: string
          policy_tags?: Json
          prospect_id?: string | null
          provider?: string
          provider_entity_id?: string | null
          source_type?: string
          source_url?: string | null
          value_json?: Json
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospect_data_sources_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_data_sources_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "prospect_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_data_sources_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_enrichments: {
        Row: {
          business_id: string
          company_id: string | null
          completed_at: string | null
          cost_minor: number
          enrichment_type: string
          error_code: string | null
          id: string
          prospect_id: string | null
          provider: string
          requested_at: string
          result_json: Json
          status: string
        }
        Insert: {
          business_id: string
          company_id?: string | null
          completed_at?: string | null
          cost_minor?: number
          enrichment_type: string
          error_code?: string | null
          id?: string
          prospect_id?: string | null
          provider: string
          requested_at?: string
          result_json?: Json
          status?: string
        }
        Update: {
          business_id?: string
          company_id?: string | null
          completed_at?: string | null
          cost_minor?: number
          enrichment_type?: string
          error_code?: string | null
          id?: string
          prospect_id?: string | null
          provider?: string
          requested_at?: string
          result_json?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_enrichments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_enrichments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "prospect_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_enrichments_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_intent_matches: {
        Row: {
          business_id: string
          expires_at: string
          id: string
          intent_category_id: string
          intent_event_id: string
          matched_at: string
          prospect_id: string
          score_impact: number
        }
        Insert: {
          business_id: string
          expires_at: string
          id?: string
          intent_category_id: string
          intent_event_id: string
          matched_at?: string
          prospect_id: string
          score_impact?: number
        }
        Update: {
          business_id?: string
          expires_at?: string
          id?: string
          intent_category_id?: string
          intent_event_id?: string
          matched_at?: string
          prospect_id?: string
          score_impact?: number
        }
        Relationships: [
          {
            foreignKeyName: "prospect_intent_matches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_intent_matches_intent_category_id_fkey"
            columns: ["intent_category_id"]
            isOneToOne: false
            referencedRelation: "intent_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_intent_matches_intent_event_id_fkey"
            columns: ["intent_event_id"]
            isOneToOne: false
            referencedRelation: "intent_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_intent_matches_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_score_factors: {
        Row: {
          business_id: string
          confidence: number
          contribution: number
          direction: string
          evidence_source: string | null
          evidence_summary: string | null
          evidence_url: string | null
          factor: string
          id: string
          observed_at: string | null
          prospect_score_id: string
          raw_value: number
          weight: number
        }
        Insert: {
          business_id: string
          confidence?: number
          contribution: number
          direction?: string
          evidence_source?: string | null
          evidence_summary?: string | null
          evidence_url?: string | null
          factor: string
          id?: string
          observed_at?: string | null
          prospect_score_id: string
          raw_value: number
          weight: number
        }
        Update: {
          business_id?: string
          confidence?: number
          contribution?: number
          direction?: string
          evidence_source?: string | null
          evidence_summary?: string | null
          evidence_url?: string | null
          factor?: string
          id?: string
          observed_at?: string | null
          prospect_score_id?: string
          raw_value?: number
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "prospect_score_factors_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_score_factors_prospect_score_id_fkey"
            columns: ["prospect_score_id"]
            isOneToOne: false
            referencedRelation: "prospect_scores"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_scores: {
        Row: {
          agent_run_id: string | null
          business_id: string
          created_at: string
          explanation: string | null
          factor_json: Json
          grade: string
          id: string
          is_current: boolean
          prospect_id: string
          score_version: string
          total_score: number
        }
        Insert: {
          agent_run_id?: string | null
          business_id: string
          created_at?: string
          explanation?: string | null
          factor_json?: Json
          grade: string
          id?: string
          is_current?: boolean
          prospect_id: string
          score_version: string
          total_score: number
        }
        Update: {
          agent_run_id?: string | null
          business_id?: string
          created_at?: string
          explanation?: string | null
          factor_json?: Json
          grade?: string
          id?: string
          is_current?: boolean
          prospect_id?: string
          score_version?: string
          total_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "prospect_scores_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_scores_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_verifications: {
        Row: {
          business_id: string
          channel: string
          cost_minor: number
          detail_json: Json
          id: string
          prospect_id: string
          provider: string
          result: string
          score: number | null
          verified_at: string
        }
        Insert: {
          business_id: string
          channel?: string
          cost_minor?: number
          detail_json?: Json
          id?: string
          prospect_id: string
          provider: string
          result: string
          score?: number | null
          verified_at?: string
        }
        Update: {
          business_id?: string
          channel?: string
          cost_minor?: number
          detail_json?: Json
          id?: string
          prospect_id?: string
          provider?: string
          result?: string
          score?: number | null
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_verifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_verifications_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospects: {
        Row: {
          agent_id: string | null
          approved_at: string | null
          approved_by: string | null
          business_id: string
          campaign_id: string | null
          company_id: string | null
          conversation_id: string | null
          created_at: string
          eligibility_reason: string | null
          email: string | null
          first_name: string | null
          grade: string | null
          icp_profile_id: string | null
          id: string
          is_test: boolean
          last_activity_at: string | null
          last_contacted_at: string | null
          last_name: string | null
          linkedin_url: string | null
          location_json: Json
          outreach_eligibility: string
          phone_e164: string | null
          promoted_at: string | null
          promoted_to_lead_id: string | null
          replied_at: string | null
          role_classification: string
          role_title: string | null
          score: number | null
          source_provider: string | null
          source_run_id: string | null
          status: string
          subscriber_type: string
          updated_at: string
          verification_status: string
        }
        Insert: {
          agent_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          campaign_id?: string | null
          company_id?: string | null
          conversation_id?: string | null
          created_at?: string
          eligibility_reason?: string | null
          email?: string | null
          first_name?: string | null
          grade?: string | null
          icp_profile_id?: string | null
          id?: string
          is_test?: boolean
          last_activity_at?: string | null
          last_contacted_at?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          location_json?: Json
          outreach_eligibility?: string
          phone_e164?: string | null
          promoted_at?: string | null
          promoted_to_lead_id?: string | null
          replied_at?: string | null
          role_classification?: string
          role_title?: string | null
          score?: number | null
          source_provider?: string | null
          source_run_id?: string | null
          status?: string
          subscriber_type?: string
          updated_at?: string
          verification_status?: string
        }
        Update: {
          agent_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          campaign_id?: string | null
          company_id?: string | null
          conversation_id?: string | null
          created_at?: string
          eligibility_reason?: string | null
          email?: string | null
          first_name?: string | null
          grade?: string | null
          icp_profile_id?: string | null
          id?: string
          is_test?: boolean
          last_activity_at?: string | null
          last_contacted_at?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          location_json?: Json
          outreach_eligibility?: string
          phone_e164?: string | null
          promoted_at?: string | null
          promoted_to_lead_id?: string | null
          replied_at?: string | null
          role_classification?: string
          role_title?: string | null
          score?: number | null
          source_provider?: string | null
          source_run_id?: string | null
          status?: string
          subscriber_type?: string
          updated_at?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospects_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "prospect_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_conversation_fk"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_icp_profile_id_fkey"
            columns: ["icp_profile_id"]
            isOneToOne: false
            referencedRelation: "icp_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_promoted_to_lead_id_fkey"
            columns: ["promoted_to_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_source_run_fk"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "sourcing_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_price_book: {
        Row: {
          capability: string | null
          created_at: string
          currency: string
          effective_from: string
          effective_to: string | null
          id: string
          metadata: Json
          notes: string | null
          product: string
          provider: string
          region: string | null
          unit: string
          unit_cost: number
          updated_by: string | null
        }
        Insert: {
          capability?: string | null
          created_at?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          product: string
          provider: string
          region?: string | null
          unit: string
          unit_cost: number
          updated_by?: string | null
        }
        Update: {
          capability?: string | null
          created_at?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          product?: string
          provider?: string
          region?: string | null
          unit?: string
          unit_cost?: number
          updated_by?: string | null
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
      recurring_searches: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_id: string
          cadence: string
          campaign_id: string | null
          created_at: string
          id: string
          last_run_at: string | null
          max_cost_per_run_minor: number
          next_run_at: string | null
          search_strategy_id: string
          session_id: string | null
          status: string
          target_per_run: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          cadence?: string
          campaign_id?: string | null
          created_at?: string
          id?: string
          last_run_at?: string | null
          max_cost_per_run_minor?: number
          next_run_at?: string | null
          search_strategy_id: string
          session_id?: string | null
          status?: string
          target_per_run?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          cadence?: string
          campaign_id?: string | null
          created_at?: string
          id?: string
          last_run_at?: string | null
          max_cost_per_run_minor?: number
          next_run_at?: string | null
          search_strategy_id?: string
          session_id?: string | null
          status?: string
          target_per_run?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_searches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_searches_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_searches_search_strategy_id_fkey"
            columns: ["search_strategy_id"]
            isOneToOne: false
            referencedRelation: "search_strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_searches_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "search_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      search_feedback: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          prospect_id: string | null
          session_id: string | null
          verdict: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          prospect_id?: string | null
          session_id?: string | null
          verdict: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          prospect_id?: string | null
          session_id?: string | null
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_feedback_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_feedback_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "search_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      search_messages: {
        Row: {
          agent_run_id: string | null
          business_id: string
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
          structured_data: Json | null
        }
        Insert: {
          agent_run_id?: string | null
          business_id: string
          content: string
          created_at?: string
          id?: string
          role: string
          session_id: string
          structured_data?: Json | null
        }
        Update: {
          agent_run_id?: string | null
          business_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          structured_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "search_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "search_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      search_sessions: {
        Row: {
          business_id: string
          conversion_goal_id: string | null
          created_at: string
          icp_profile_id: string | null
          id: string
          last_run_id: string | null
          latest_strategy_id: string | null
          message_count: number
          prospects_found: number
          status: string
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          business_id: string
          conversion_goal_id?: string | null
          created_at?: string
          icp_profile_id?: string | null
          id?: string
          last_run_id?: string | null
          latest_strategy_id?: string | null
          message_count?: number
          prospects_found?: number
          status?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          business_id?: string
          conversion_goal_id?: string | null
          created_at?: string
          icp_profile_id?: string | null
          id?: string
          last_run_id?: string | null
          latest_strategy_id?: string | null
          message_count?: number
          prospects_found?: number
          status?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "search_sessions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_sessions_conversion_goal_id_fkey"
            columns: ["conversion_goal_id"]
            isOneToOne: false
            referencedRelation: "conversion_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_sessions_icp_profile_id_fkey"
            columns: ["icp_profile_id"]
            isOneToOne: false
            referencedRelation: "icp_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_sessions_last_run_id_fkey"
            columns: ["last_run_id"]
            isOneToOne: false
            referencedRelation: "sourcing_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_sessions_latest_strategy_fk"
            columns: ["latest_strategy_id"]
            isOneToOne: false
            referencedRelation: "search_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      search_strategies: {
        Row: {
          agent_run_id: string | null
          approved_at: string | null
          approved_by: string | null
          business_id: string
          created_at: string
          estimated_cost_band: string
          estimated_cost_minor: number
          estimated_provider_calls: Json
          id: string
          session_id: string
          status: string
          strategy_json: Json
          version: number
        }
        Insert: {
          agent_run_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          created_at?: string
          estimated_cost_band?: string
          estimated_cost_minor?: number
          estimated_provider_calls?: Json
          id?: string
          session_id: string
          status?: string
          strategy_json?: Json
          version?: number
        }
        Update: {
          agent_run_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          created_at?: string
          estimated_cost_band?: string
          estimated_cost_minor?: number
          estimated_provider_calls?: Json
          id?: string
          session_id?: string
          status?: string
          strategy_json?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "search_strategies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_strategies_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "search_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      search_strategy_versions: {
        Row: {
          business_id: string
          changed_by: string
          changed_by_user_id: string | null
          created_at: string
          diff_json: Json
          id: string
          snapshot_json: Json
          strategy_id: string
          version: number
        }
        Insert: {
          business_id: string
          changed_by?: string
          changed_by_user_id?: string | null
          created_at?: string
          diff_json?: Json
          id?: string
          snapshot_json?: Json
          strategy_id: string
          version: number
        }
        Update: {
          business_id?: string
          changed_by?: string
          changed_by_user_id?: string | null
          created_at?: string
          diff_json?: Json
          id?: string
          snapshot_json?: Json
          strategy_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "search_strategy_versions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_strategy_versions_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "search_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      sender_identities: {
        Row: {
          active: boolean
          business_id: string
          cold_enabled: boolean
          created_at: string
          daily_send_cap: number
          display_name: string
          domain: string | null
          email: string
          id: string
          is_default: boolean
          last_test_at: string | null
          last_test_error: string | null
          logo_key: string | null
          mailbox_connection_id: string | null
          pause_reason: string | null
          paused_until: string | null
          postal_footer: string | null
          prefer_plain_text: boolean
          reply_to: string | null
          sent_today: number
          sent_today_on: string | null
          signature_text: string | null
          status: string
          updated_at: string
          verified_at: string | null
          warm_enabled: boolean
        }
        Insert: {
          active?: boolean
          business_id: string
          cold_enabled?: boolean
          created_at?: string
          daily_send_cap?: number
          display_name: string
          domain?: string | null
          email: string
          id?: string
          is_default?: boolean
          last_test_at?: string | null
          last_test_error?: string | null
          logo_key?: string | null
          mailbox_connection_id?: string | null
          pause_reason?: string | null
          paused_until?: string | null
          postal_footer?: string | null
          prefer_plain_text?: boolean
          reply_to?: string | null
          sent_today?: number
          sent_today_on?: string | null
          signature_text?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
          warm_enabled?: boolean
        }
        Update: {
          active?: boolean
          business_id?: string
          cold_enabled?: boolean
          created_at?: string
          daily_send_cap?: number
          display_name?: string
          domain?: string | null
          email?: string
          id?: string
          is_default?: boolean
          last_test_at?: string | null
          last_test_error?: string | null
          logo_key?: string | null
          mailbox_connection_id?: string | null
          pause_reason?: string | null
          paused_until?: string | null
          postal_footer?: string | null
          prefer_plain_text?: boolean
          reply_to?: string | null
          sent_today?: number
          sent_today_on?: string | null
          signature_text?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
          warm_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sender_identities_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sender_identities_mailbox_connection_id_fkey"
            columns: ["mailbox_connection_id"]
            isOneToOne: false
            referencedRelation: "mailbox_connections"
            referencedColumns: ["id"]
          },
        ]
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
          pricing_visibility: string
          public_price_text: string | null
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
          pricing_visibility?: string
          public_price_text?: string | null
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
          pricing_visibility?: string
          public_price_text?: string | null
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
      sourcing_run_issues: {
        Row: {
          business_id: string
          code: string
          created_at: string
          detail_json: Json
          id: string
          message: string
          requires_user_action: boolean
          resolved_at: string | null
          run_id: string
          severity: string
        }
        Insert: {
          business_id: string
          code: string
          created_at?: string
          detail_json?: Json
          id?: string
          message: string
          requires_user_action?: boolean
          resolved_at?: string | null
          run_id: string
          severity?: string
        }
        Update: {
          business_id?: string
          code?: string
          created_at?: string
          detail_json?: Json
          id?: string
          message?: string
          requires_user_action?: boolean
          resolved_at?: string | null
          run_id?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_run_issues_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_run_issues_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sourcing_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sourcing_run_queries: {
        Row: {
          business_id: string
          capability: string
          completed_at: string | null
          cost_minor: number
          created_at: string
          error_code: string | null
          id: string
          idempotency_key: string | null
          latency_ms: number | null
          provider: string
          request_json: Json
          result_count: number
          run_id: string
          stage: string
          status: string
        }
        Insert: {
          business_id: string
          capability: string
          completed_at?: string | null
          cost_minor?: number
          created_at?: string
          error_code?: string | null
          id?: string
          idempotency_key?: string | null
          latency_ms?: number | null
          provider: string
          request_json?: Json
          result_count?: number
          run_id: string
          stage: string
          status?: string
        }
        Update: {
          business_id?: string
          capability?: string
          completed_at?: string | null
          cost_minor?: number
          created_at?: string
          error_code?: string | null
          id?: string
          idempotency_key?: string | null
          latency_ms?: number | null
          provider?: string
          request_json?: Json
          result_count?: number
          run_id?: string
          stage?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_run_queries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_run_queries_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sourcing_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sourcing_run_results: {
        Row: {
          business_id: string
          candidate_domain: string | null
          candidate_name: string | null
          company_id: string | null
          cost_minor: number
          created_at: string
          grade: string | null
          id: string
          outcome: string
          prospect_id: string | null
          reason: string | null
          run_id: string
          score: number | null
        }
        Insert: {
          business_id: string
          candidate_domain?: string | null
          candidate_name?: string | null
          company_id?: string | null
          cost_minor?: number
          created_at?: string
          grade?: string | null
          id?: string
          outcome: string
          prospect_id?: string | null
          reason?: string | null
          run_id: string
          score?: number | null
        }
        Update: {
          business_id?: string
          candidate_domain?: string | null
          candidate_name?: string | null
          company_id?: string | null
          cost_minor?: number
          created_at?: string
          grade?: string | null
          id?: string
          outcome?: string
          prospect_id?: string | null
          reason?: string | null
          run_id?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_run_results_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_run_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "prospect_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_run_results_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_run_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sourcing_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sourcing_run_stages: {
        Row: {
          business_id: string
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          id: string
          record_count: number
          run_id: string
          safe_summary: string | null
          stage_key: string
          stage_number: number
          started_at: string | null
          status: string
        }
        Insert: {
          business_id: string
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          id?: string
          record_count?: number
          run_id: string
          safe_summary?: string | null
          stage_key: string
          stage_number: number
          started_at?: string | null
          status?: string
        }
        Update: {
          business_id?: string
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          id?: string
          record_count?: number
          run_id?: string
          safe_summary?: string | null
          stage_key?: string
          stage_number?: number
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_run_stages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_run_stages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sourcing_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sourcing_runs: {
        Row: {
          agent_id: string | null
          budget_state: string
          business_id: string
          campaign_id: string | null
          cancel_requested: boolean
          checkpoint_json: Json
          completed_at: string | null
          counts_json: Json
          created_at: string
          current_stage: string
          deadline_at: string | null
          error_code: string | null
          error_message: string | null
          id: string
          limits_json: Json
          max_provider_cost_minor: number
          max_total_cost_minor: number
          minimum_grade: string
          paused_at: string | null
          paused_reason: string | null
          progress_percent: number
          review_before_outreach: boolean
          search_strategy_id: string | null
          session_id: string | null
          spent_cost_minor: number
          started_at: string | null
          started_by: string | null
          status: string
          stopped_at: string | null
          target_verified: number
          title: string | null
          trigger_source: string
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          budget_state?: string
          business_id: string
          campaign_id?: string | null
          cancel_requested?: boolean
          checkpoint_json?: Json
          completed_at?: string | null
          counts_json?: Json
          created_at?: string
          current_stage?: string
          deadline_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          limits_json?: Json
          max_provider_cost_minor?: number
          max_total_cost_minor?: number
          minimum_grade?: string
          paused_at?: string | null
          paused_reason?: string | null
          progress_percent?: number
          review_before_outreach?: boolean
          search_strategy_id?: string | null
          session_id?: string | null
          spent_cost_minor?: number
          started_at?: string | null
          started_by?: string | null
          status?: string
          stopped_at?: string | null
          target_verified?: number
          title?: string | null
          trigger_source?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          budget_state?: string
          business_id?: string
          campaign_id?: string | null
          cancel_requested?: boolean
          checkpoint_json?: Json
          completed_at?: string | null
          counts_json?: Json
          created_at?: string
          current_stage?: string
          deadline_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          limits_json?: Json
          max_provider_cost_minor?: number
          max_total_cost_minor?: number
          minimum_grade?: string
          paused_at?: string | null
          paused_reason?: string | null
          progress_percent?: number
          review_before_outreach?: boolean
          search_strategy_id?: string | null
          session_id?: string | null
          spent_cost_minor?: number
          started_at?: string | null
          started_by?: string | null
          status?: string
          stopped_at?: string | null
          target_verified?: number
          title?: string | null
          trigger_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_runs_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_runs_search_strategy_id_fkey"
            columns: ["search_strategy_id"]
            isOneToOne: false
            referencedRelation: "search_strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_runs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "search_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          ai_assist_allowed: boolean
          analytics_tier: string
          auto_optimize_tier: string
          billing_interval: string | null
          business_id: string
          campaigns_enabled: boolean
          cancel_at_period_end: boolean
          cancelled_at: string | null
          cold_email_enabled: boolean
          communication_pool_minor: number
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          intent_monitor_limit: number
          lead_limit: number
          plan: string
          plan_amount_minor: number
          search_capacity: number
          sender_limit: number
          sourcing_enabled: boolean
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
          user_limit: number
          verified_prospect_limit: number
          whatsapp_enabled: boolean
        }
        Insert: {
          ai_assist_allowed?: boolean
          analytics_tier?: string
          auto_optimize_tier?: string
          billing_interval?: string | null
          business_id: string
          campaigns_enabled?: boolean
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          cold_email_enabled?: boolean
          communication_pool_minor?: number
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          intent_monitor_limit?: number
          lead_limit?: number
          plan?: string
          plan_amount_minor?: number
          search_capacity?: number
          sender_limit?: number
          sourcing_enabled?: boolean
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
          user_limit?: number
          verified_prospect_limit?: number
          whatsapp_enabled?: boolean
        }
        Update: {
          ai_assist_allowed?: boolean
          analytics_tier?: string
          auto_optimize_tier?: string
          billing_interval?: string | null
          business_id?: string
          campaigns_enabled?: boolean
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          cold_email_enabled?: boolean
          communication_pool_minor?: number
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          intent_monitor_limit?: number
          lead_limit?: number
          plan?: string
          plan_amount_minor?: number
          search_capacity?: number
          sender_limit?: number
          sourcing_enabled?: boolean
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
          user_limit?: number
          verified_prospect_limit?: number
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
      support_articles: {
        Row: {
          body_markdown: string
          category: string
          created_at: string
          id: string
          keywords: string[]
          slug: string
          status: string
          summary: string | null
          title: string
          updated_at: string
          view_count: number
        }
        Insert: {
          body_markdown: string
          category?: string
          created_at?: string
          id?: string
          keywords?: string[]
          slug: string
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          body_markdown?: string
          category?: string
          created_at?: string
          id?: string
          keywords?: string[]
          slug?: string
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: []
      }
      support_assignments: {
        Row: {
          action: string
          admin_user_id: string | null
          assigned_by: string | null
          created_at: string
          detail: string | null
          id: string
          ticket_id: string
        }
        Insert: {
          action?: string
          admin_user_id?: string | null
          assigned_by?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          ticket_id: string
        }
        Update: {
          action?: string
          admin_user_id?: string | null
          assigned_by?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_assignments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_attachments: {
        Row: {
          business_id: string | null
          content_type: string | null
          created_at: string
          filename: string
          id: string
          message_id: string | null
          scan_state: string
          size_bytes: number
          storage_key: string
          ticket_id: string
          uploaded_by: string | null
        }
        Insert: {
          business_id?: string | null
          content_type?: string | null
          created_at?: string
          filename: string
          id?: string
          message_id?: string | null
          scan_state?: string
          size_bytes?: number
          storage_key: string
          ticket_id: string
          uploaded_by?: string | null
        }
        Update: {
          business_id?: string | null
          content_type?: string | null
          created_at?: string
          filename?: string
          id?: string
          message_id?: string | null
          scan_state?: string
          size_bytes?: number
          storage_key?: string
          ticket_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_attachments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "support_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          author_email: string | null
          author_name: string | null
          author_user_id: string | null
          body: string
          body_html: string | null
          business_id: string | null
          channel: string
          created_at: string
          delivery_state: string
          direction: string
          error_message: string | null
          id: string
          in_reply_to_header: string | null
          message_id_header: string | null
          provider: string | null
          provider_message_id: string | null
          references_header: string | null
          ticket_id: string
        }
        Insert: {
          author_email?: string | null
          author_name?: string | null
          author_user_id?: string | null
          body: string
          body_html?: string | null
          business_id?: string | null
          channel?: string
          created_at?: string
          delivery_state?: string
          direction: string
          error_message?: string | null
          id?: string
          in_reply_to_header?: string | null
          message_id_header?: string | null
          provider?: string | null
          provider_message_id?: string | null
          references_header?: string | null
          ticket_id: string
        }
        Update: {
          author_email?: string | null
          author_name?: string | null
          author_user_id?: string | null
          body?: string
          body_html?: string | null
          business_id?: string | null
          channel?: string
          created_at?: string
          delivery_state?: string
          direction?: string
          error_message?: string | null
          id?: string
          in_reply_to_header?: string | null
          message_id_header?: string | null
          provider?: string | null
          provider_message_id?: string | null
          references_header?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_notes: {
        Row: {
          agent_run_id: string | null
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          is_ai_draft: boolean
          ticket_id: string
        }
        Insert: {
          agent_run_id?: string | null
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          is_ai_draft?: boolean
          ticket_id: string
        }
        Update: {
          agent_run_id?: string | null
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          is_ai_draft?: boolean
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_notes_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_notes_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          ai_category_confidence: number | null
          ai_summary: string | null
          assigned_admin_id: string | null
          business_id: string | null
          category: string
          closed_at: string | null
          context_json: Json
          created_at: string
          created_by_user_id: string | null
          email_thread_key: string | null
          first_response_at: string | null
          id: string
          last_admin_message_at: string | null
          last_customer_message_at: string | null
          priority: string
          reference: string | null
          requester_email: string | null
          requester_name: string | null
          resolved_at: string | null
          source: string
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          ai_category_confidence?: number | null
          ai_summary?: string | null
          assigned_admin_id?: string | null
          business_id?: string | null
          category?: string
          closed_at?: string | null
          context_json?: Json
          created_at?: string
          created_by_user_id?: string | null
          email_thread_key?: string | null
          first_response_at?: string | null
          id?: string
          last_admin_message_at?: string | null
          last_customer_message_at?: string | null
          priority?: string
          reference?: string | null
          requester_email?: string | null
          requester_name?: string | null
          resolved_at?: string | null
          source?: string
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          ai_category_confidence?: number | null
          ai_summary?: string | null
          assigned_admin_id?: string | null
          business_id?: string | null
          category?: string
          closed_at?: string | null
          context_json?: Json
          created_at?: string
          created_by_user_id?: string | null
          email_thread_key?: string | null
          first_response_at?: string | null
          id?: string
          last_admin_message_at?: string | null
          last_customer_message_at?: string | null
          priority?: string
          reference?: string | null
          requester_email?: string | null
          requester_name?: string | null
          resolved_at?: string | null
          source?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      suppression_entries: {
        Row: {
          business_id: string | null
          channel: string
          created_at: string
          created_by: string | null
          email: string | null
          expires_at: string | null
          id: string
          note: string | null
          phone_e164: string | null
          reason: string
          social_identifier: string | null
          source: string
          source_reference: string | null
        }
        Insert: {
          business_id?: string | null
          channel?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          expires_at?: string | null
          id?: string
          note?: string | null
          phone_e164?: string | null
          reason: string
          social_identifier?: string | null
          source?: string
          source_reference?: string | null
        }
        Update: {
          business_id?: string | null
          channel?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          expires_at?: string | null
          id?: string
          note?: string | null
          phone_e164?: string | null
          reason?: string
          social_identifier?: string | null
          source?: string
          source_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppression_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_conflicts: {
        Row: {
          business_id: string
          conflict_kind: string
          connection_id: string
          created_at: string
          external_id: string | null
          external_type: string | null
          external_value: Json | null
          field_name: string | null
          id: string
          local_id: string | null
          local_type: string
          local_value: Json | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          sync_run_id: string | null
        }
        Insert: {
          business_id: string
          conflict_kind?: string
          connection_id: string
          created_at?: string
          external_id?: string | null
          external_type?: string | null
          external_value?: Json | null
          field_name?: string | null
          id?: string
          local_id?: string | null
          local_type: string
          local_value?: Json | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          sync_run_id?: string | null
        }
        Update: {
          business_id?: string
          conflict_kind?: string
          connection_id?: string
          created_at?: string
          external_id?: string | null
          external_type?: string | null
          external_value?: Json | null
          field_name?: string | null
          id?: string
          local_id?: string | null
          local_type?: string
          local_value?: Json | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          sync_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_conflicts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_conflicts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "external_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_conflicts_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          business_id: string
          completed_at: string | null
          conflict_count: number
          connection_id: string
          cursor_after: string | null
          cursor_before: string | null
          direction: string
          entity_type: string
          error_message: string | null
          id: string
          records_read: number
          records_skipped: number
          records_written: number
          started_at: string
          status: string
        }
        Insert: {
          business_id: string
          completed_at?: string | null
          conflict_count?: number
          connection_id: string
          cursor_after?: string | null
          cursor_before?: string | null
          direction: string
          entity_type: string
          error_message?: string | null
          id?: string
          records_read?: number
          records_skipped?: number
          records_written?: number
          started_at?: string
          status?: string
        }
        Update: {
          business_id?: string
          completed_at?: string | null
          conflict_count?: number
          connection_id?: string
          cursor_after?: string | null
          cursor_before?: string | null
          direction?: string
          entity_type?: string
          error_message?: string | null
          id?: string
          records_read?: number
          records_skipped?: number
          records_written?: number
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_runs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "external_connections"
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
      usage_reservations: {
        Row: {
          actual_cost_minor: number | null
          billing_period: string
          business_id: string
          estimated_cost_minor: number
          expires_at: string
          id: string
          idempotency_key: string | null
          metric: string
          quantity: number
          reserved_at: string
          settled_at: string | null
          status: string
          subject_id: string | null
          subject_type: string | null
        }
        Insert: {
          actual_cost_minor?: number | null
          billing_period: string
          business_id: string
          estimated_cost_minor?: number
          expires_at?: string
          id?: string
          idempotency_key?: string | null
          metric: string
          quantity?: number
          reserved_at?: string
          settled_at?: string | null
          status?: string
          subject_id?: string | null
          subject_type?: string | null
        }
        Update: {
          actual_cost_minor?: number | null
          billing_period?: string
          business_id?: string
          estimated_cost_minor?: number
          expires_at?: string
          id?: string
          idempotency_key?: string | null
          metric?: string
          quantity?: number
          reserved_at?: string
          settled_at?: string | null
          status?: string
          subject_id?: string | null
          subject_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_reservations_business_id_fkey"
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
      workspace_app_events: {
        Row: {
          business_id: string
          created_at: string
          external_event_id: string
          id: string
          install_id: string
          payload: Json
          prospect_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          external_event_id: string
          id?: string
          install_id: string
          payload: Json
          prospect_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          external_event_id?: string
          id?: string
          install_id?: string
          payload?: Json
          prospect_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_app_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_app_events_install_id_fkey"
            columns: ["install_id"]
            isOneToOne: false
            referencedRelation: "workspace_app_installs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_app_events_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_app_installs: {
        Row: {
          active: boolean
          app_key: string
          business_id: string
          created_at: string
          id: string
          installed_by: string | null
          last_received_at: string | null
          secret_ciphertext: string
        }
        Insert: {
          active?: boolean
          app_key: string
          business_id: string
          created_at?: string
          id?: string
          installed_by?: string | null
          last_received_at?: string | null
          secret_ciphertext: string
        }
        Update: {
          active?: boolean
          app_key?: string
          business_id?: string
          created_at?: string
          id?: string
          installed_by?: string | null
          last_received_at?: string | null
          secret_ciphertext?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_app_installs_business_id_fkey"
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
      admin_event_series: {
        Args: { p_buckets: number; p_end: string; p_start: string }
        Returns: {
          bucket: number
          event_count: number
          metric: string
        }[]
      }
      agent_summaries: {
        Args: { p_business_id: string }
        Returns: {
          agent_id: string
          blocked: number
          failed: number
          leads_7d: number
          prospects_7d: number
          queued: number
        }[]
      }
      check_suppression: {
        Args: {
          p_business_id: string
          p_channel: string
          p_email?: string
          p_phone?: string
          p_social?: string
        }
        Returns: {
          created_at: string
          reason: string
          scope: string
        }[]
      }
      claim_agent_turn: {
        Args: { lock_seconds?: number; target_conversation_id: string }
        Returns: number
      }
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
      current_affiliate_id: { Args: never; Returns: string }
      expire_intent_matches: { Args: never; Returns: number }
      expire_usage_reservations: { Args: never; Returns: number }
      has_business_role: {
        Args: { allowed_roles: string[]; target_business_id: string }
        Returns: boolean
      }
      inbox_channel_counts: {
        Args: { p_business_id: string }
        Returns: {
          channel: string
          total: number
          unread: number
        }[]
      }
      is_active_affiliate: { Args: never; Returns: boolean }
      is_business_member: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      outreach_campaign_results: {
        Args: { p_business_id: string; p_campaign_id?: string }
        Returns: {
          audience_count: number
          bounced_count: number
          campaign_id: string
          contacted_count: number
          converted_count: number
          delivered_count: number
          opt_out_count: number
          pending_count: number
          positive_reply_count: number
          promoted_count: number
          reply_count: number
          stopped_count: number
        }[]
      }
      process_workspace_app_event: {
        Args: { p_business_id: string; p_event_id: string }
        Returns: string
      }
      promote_reviewed_prospect: {
        Args: {
          p_business_id: string
          p_prospect_id: string
          p_user_id: string
        }
        Returns: string
      }
      prospect_live_intent: {
        Args: { p_business_id: string; p_prospect_ids: string[] }
        Returns: {
          category_name: string
          expires_at: string
          intent_category_id: string
          match_count: number
          observed_at: string
          prospect_id: string
          score_impact: number
        }[]
      }
      prospect_quick_counts: {
        Args: { p_business_id: string }
        Returns: {
          a_grade: number
          all_count: number
          contacted: number
          intent: number
          ready: number
          replied: number
          review: number
        }[]
      }
      prune_oauth_states: { Args: never; Returns: number }
      prune_rate_limits: { Args: { older_than?: string }; Returns: number }
      reactivation_campaign_results: {
        Args: { p_business_id: string; p_campaign_id?: string }
        Returns: {
          audience_count: number
          booked_count: number
          campaign_id: string
          delivered_count: number
          failed_count: number
          pending_count: number
          previous_booked_count: number
          previous_qualified_count: number
          previous_reply_count: number
          processed_count: number
          qualified_count: number
          recent_booked_count: number
          recent_qualified_count: number
          recent_reply_count: number
          reply_count: number
          revenue_amount: number
          sent_count: number
          stopped_count: number
        }[]
      }
      reap_stalled_jobs: { Args: { stale_after?: string }; Returns: number }
      receive_workspace_app_event: {
        Args: { p_event_id: string; p_install_id: string; p_payload: Json }
        Returns: string
      }
      release_agent_turn: {
        Args: { target_conversation_id: string; turn_seq: number }
        Returns: boolean
      }
      rollup_business_cost_daily: {
        Args: { p_business_id: string; p_date: string }
        Returns: undefined
      }
      rollup_business_margin_monthly: {
        Args: { p_business_id: string; p_month: string }
        Returns: undefined
      }
      sourcing_run_counters: {
        Args: { p_business_id: string; p_run_id: string }
        Returns: {
          companies_found: number
          contacts_found: number
          duplicates: number
          emails_discovered: number
          errors: number
          ready: number
          rejected: number
          review_required: number
          suppressed: number
          verified: number
        }[]
      }
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
