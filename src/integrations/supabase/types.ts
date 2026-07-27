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
      _tm_date_shift_backup_20260725: {
        Row: {
          actual_finish: string | null
          actual_start: string | null
          backed_up_at: string | null
          data_date: string | null
          forecast_end: string | null
          plan_end: string | null
          plan_start: string | null
          task_no: string | null
          updated_at: string | null
        }
        Insert: {
          actual_finish?: string | null
          actual_start?: string | null
          backed_up_at?: string | null
          data_date?: string | null
          forecast_end?: string | null
          plan_end?: string | null
          plan_start?: string | null
          task_no?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_finish?: string | null
          actual_start?: string | null
          backed_up_at?: string | null
          data_date?: string | null
          forecast_end?: string | null
          plan_end?: string | null
          plan_start?: string | null
          task_no?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _tm_date_shift_log_20260720: {
        Row: {
          actual_finish: string | null
          actual_start: string | null
          forecast_end: string | null
          id: string | null
          logged_at: string | null
          plan_end: string | null
          plan_start: string | null
          source_file: string | null
          task_no: string | null
        }
        Insert: {
          actual_finish?: string | null
          actual_start?: string | null
          forecast_end?: string | null
          id?: string | null
          logged_at?: string | null
          plan_end?: string | null
          plan_start?: string | null
          source_file?: string | null
          task_no?: string | null
        }
        Update: {
          actual_finish?: string | null
          actual_start?: string | null
          forecast_end?: string | null
          id?: string | null
          logged_at?: string | null
          plan_end?: string | null
          plan_start?: string | null
          source_file?: string | null
          task_no?: string | null
        }
        Relationships: []
      }
      abd_change_log: {
        Row: {
          abd_item_id: string | null
          abd_number: string | null
          changed_at: string
          changed_by: string | null
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          source: string
          team: string | null
          upload_id: string | null
        }
        Insert: {
          abd_item_id?: string | null
          abd_number?: string | null
          changed_at?: string
          changed_by?: string | null
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string
          team?: string | null
          upload_id?: string | null
        }
        Update: {
          abd_item_id?: string | null
          abd_number?: string | null
          changed_at?: string
          changed_by?: string | null
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string
          team?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "abd_change_log_abd_item_id_fkey"
            columns: ["abd_item_id"]
            isOneToOne: false
            referencedRelation: "abd_items_raw"
            referencedColumns: ["id"]
          },
        ]
      }
      abd_comments: {
        Row: {
          abd_item_id: string
          author_user_id: string | null
          category: string
          created_at: string
          edited: boolean
          id: string
          message: string
          parent_comment_id: string | null
          source: string
          updated_at: string
        }
        Insert: {
          abd_item_id: string
          author_user_id?: string | null
          category?: string
          created_at?: string
          edited?: boolean
          id?: string
          message: string
          parent_comment_id?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          abd_item_id?: string
          author_user_id?: string | null
          category?: string
          created_at?: string
          edited?: boolean
          id?: string
          message?: string
          parent_comment_id?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "abd_comments_abd_item_id_fkey"
            columns: ["abd_item_id"]
            isOneToOne: false
            referencedRelation: "abd_items_raw"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abd_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "abd_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      abd_field_config: {
        Row: {
          created_at: string
          data_type: string
          editable: boolean
          editable_to_roles: Database["public"]["Enums"]["app_role"][]
          field_key: string
          group: string | null
          id: string
          label: string
          options: Json | null
          sort_order: number
          source_group: string
          updated_at: string
          visible: boolean
          visible_to_roles: Database["public"]["Enums"]["app_role"][]
        }
        Insert: {
          created_at?: string
          data_type?: string
          editable?: boolean
          editable_to_roles?: Database["public"]["Enums"]["app_role"][]
          field_key: string
          group?: string | null
          id?: string
          label: string
          options?: Json | null
          sort_order?: number
          source_group?: string
          updated_at?: string
          visible?: boolean
          visible_to_roles?: Database["public"]["Enums"]["app_role"][]
        }
        Update: {
          created_at?: string
          data_type?: string
          editable?: boolean
          editable_to_roles?: Database["public"]["Enums"]["app_role"][]
          field_key?: string
          group?: string | null
          id?: string
          label?: string
          options?: Json | null
          sort_order?: number
          source_group?: string
          updated_at?: string
          visible?: boolean
          visible_to_roles?: Database["public"]["Enums"]["app_role"][]
        }
        Relationships: []
      }
      abd_header_mappings: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_active: boolean
          is_custom: boolean
          note: string | null
          plan_or_actual: string | null
          round_index: number | null
          source_header: string
          stage: string | null
          target_field: string
          team: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          is_custom?: boolean
          note?: string | null
          plan_or_actual?: string | null
          round_index?: number | null
          source_header: string
          stage?: string | null
          target_field: string
          team: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          is_custom?: boolean
          note?: string | null
          plan_or_actual?: string | null
          round_index?: number | null
          source_header?: string
          stage?: string | null
          target_field?: string
          team?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      abd_import_logs: {
        Row: {
          created_at: string
          errors: Json | null
          file_name: string
          finished_at: string | null
          id: string
          imported_by: string | null
          inactivated: number | null
          inserted: number | null
          mismatched: number | null
          note: string | null
          plot: string | null
          rollback_force: boolean | null
          rolled_back_at: string | null
          rolled_back_by: string | null
          sheet_name: string | null
          skipped_no_key: number | null
          source_kind: string
          started_at: string | null
          status: string
          team: string | null
          total_rows: number | null
          updated: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          errors?: Json | null
          file_name: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          inactivated?: number | null
          inserted?: number | null
          mismatched?: number | null
          note?: string | null
          plot?: string | null
          rollback_force?: boolean | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          sheet_name?: string | null
          skipped_no_key?: number | null
          source_kind?: string
          started_at?: string | null
          status?: string
          team?: string | null
          total_rows?: number | null
          updated?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          errors?: Json | null
          file_name?: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          inactivated?: number | null
          inserted?: number | null
          mismatched?: number | null
          note?: string | null
          plot?: string | null
          rollback_force?: boolean | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          sheet_name?: string | null
          skipped_no_key?: number | null
          source_kind?: string
          started_at?: string | null
          status?: string
          team?: string | null
          total_rows?: number | null
          updated?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      abd_import_presets: {
        Row: {
          created_at: string
          fields: string[]
          id: string
          label: string
          mode: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          fields?: string[]
          id?: string
          label: string
          mode: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          fields?: string[]
          id?: string
          label?: string
          mode?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      abd_import_row_logs: {
        Row: {
          abd_number: string | null
          action_taken: string
          id: string
          processed_at: string
          raw_row_no: number | null
          reason_code: string | null
          reason_detail: string | null
          team: string | null
          upload_id: string
        }
        Insert: {
          abd_number?: string | null
          action_taken: string
          id?: string
          processed_at?: string
          raw_row_no?: number | null
          reason_code?: string | null
          reason_detail?: string | null
          team?: string | null
          upload_id: string
        }
        Update: {
          abd_number?: string | null
          action_taken?: string
          id?: string
          processed_at?: string
          raw_row_no?: number | null
          reason_code?: string | null
          reason_detail?: string | null
          team?: string | null
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "abd_import_row_logs_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "abd_import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      abd_items_raw: {
        Row: {
          abd_number: string
          abd_ocs_no: string | null
          aconex_date_modified: string | null
          aconex_last_synced_at: string | null
          aconex_review_status_raw: string | null
          aconex_status_raw: string | null
          active_round: number | null
          approval_date: string | null
          batch_no: string | null
          bucket_top: string | null
          created_at: string
          current_stage: string | null
          data_date: string | null
          delay_bucket: string[]
          dis: string | null
          doc_ax: string | null
          doc_axx: string | null
          doc_n: string | null
          doc_nn1: string | null
          doc_nn2: string | null
          document_title: string | null
          extra_rounds: Json | null
          field_mismatch: boolean
          has_r4_plus: boolean
          hdec_eng_name: string | null
          hdec_pic_name: string | null
          id: string
          inactive_reason: string | null
          is_active: boolean
          is_terminated: boolean
          latest_rev: string | null
          latest_status: string | null
          latest_status_norm: string | null
          mismatch_fields: Json
          needs_planning: boolean
          needs_revise: boolean
          owner_user_id: string | null
          plot: string | null
          r1_dar_actual: string | null
          r1_dar_plan: string | null
          r1_draft_finish_actual: string | null
          r1_draft_finish_plan: string | null
          r1_draft_start_actual: string | null
          r1_draft_start_plan: string | null
          r1_response_result: string | null
          r1_submission_actual: string | null
          r1_submission_plan: string | null
          r2_dar_actual: string | null
          r2_dar_plan: string | null
          r2_draft_finish_actual: string | null
          r2_draft_finish_plan: string | null
          r2_draft_start_actual: string | null
          r2_draft_start_plan: string | null
          r2_response_result: string | null
          r2_submission_actual: string | null
          r2_submission_plan: string | null
          r3_dar_actual: string | null
          r3_dar_plan: string | null
          r3_draft_finish_actual: string | null
          r3_draft_finish_plan: string | null
          r3_draft_start_actual: string | null
          r3_draft_start_plan: string | null
          r3_response_result: string | null
          r3_submission_actual: string | null
          r3_submission_plan: string | null
          raw_payload: Json
          revise_source_round: number | null
          row_version: number
          rs_result_missing: boolean
          service: string | null
          sl_no: number | null
          source_import_log_id: string | null
          status_group: string | null
          status_mismatch: boolean
          team: string
          updated_at: string
          updated_by: string | null
          ur_aging_days: number | null
        }
        Insert: {
          abd_number: string
          abd_ocs_no?: string | null
          aconex_date_modified?: string | null
          aconex_last_synced_at?: string | null
          aconex_review_status_raw?: string | null
          aconex_status_raw?: string | null
          active_round?: number | null
          approval_date?: string | null
          batch_no?: string | null
          bucket_top?: string | null
          created_at?: string
          current_stage?: string | null
          data_date?: string | null
          delay_bucket?: string[]
          dis?: string | null
          doc_ax?: string | null
          doc_axx?: string | null
          doc_n?: string | null
          doc_nn1?: string | null
          doc_nn2?: string | null
          document_title?: string | null
          extra_rounds?: Json | null
          field_mismatch?: boolean
          has_r4_plus?: boolean
          hdec_eng_name?: string | null
          hdec_pic_name?: string | null
          id?: string
          inactive_reason?: string | null
          is_active?: boolean
          is_terminated?: boolean
          latest_rev?: string | null
          latest_status?: string | null
          latest_status_norm?: string | null
          mismatch_fields?: Json
          needs_planning?: boolean
          needs_revise?: boolean
          owner_user_id?: string | null
          plot?: string | null
          r1_dar_actual?: string | null
          r1_dar_plan?: string | null
          r1_draft_finish_actual?: string | null
          r1_draft_finish_plan?: string | null
          r1_draft_start_actual?: string | null
          r1_draft_start_plan?: string | null
          r1_response_result?: string | null
          r1_submission_actual?: string | null
          r1_submission_plan?: string | null
          r2_dar_actual?: string | null
          r2_dar_plan?: string | null
          r2_draft_finish_actual?: string | null
          r2_draft_finish_plan?: string | null
          r2_draft_start_actual?: string | null
          r2_draft_start_plan?: string | null
          r2_response_result?: string | null
          r2_submission_actual?: string | null
          r2_submission_plan?: string | null
          r3_dar_actual?: string | null
          r3_dar_plan?: string | null
          r3_draft_finish_actual?: string | null
          r3_draft_finish_plan?: string | null
          r3_draft_start_actual?: string | null
          r3_draft_start_plan?: string | null
          r3_response_result?: string | null
          r3_submission_actual?: string | null
          r3_submission_plan?: string | null
          raw_payload?: Json
          revise_source_round?: number | null
          row_version?: number
          rs_result_missing?: boolean
          service?: string | null
          sl_no?: number | null
          source_import_log_id?: string | null
          status_group?: string | null
          status_mismatch?: boolean
          team: string
          updated_at?: string
          updated_by?: string | null
          ur_aging_days?: number | null
        }
        Update: {
          abd_number?: string
          abd_ocs_no?: string | null
          aconex_date_modified?: string | null
          aconex_last_synced_at?: string | null
          aconex_review_status_raw?: string | null
          aconex_status_raw?: string | null
          active_round?: number | null
          approval_date?: string | null
          batch_no?: string | null
          bucket_top?: string | null
          created_at?: string
          current_stage?: string | null
          data_date?: string | null
          delay_bucket?: string[]
          dis?: string | null
          doc_ax?: string | null
          doc_axx?: string | null
          doc_n?: string | null
          doc_nn1?: string | null
          doc_nn2?: string | null
          document_title?: string | null
          extra_rounds?: Json | null
          field_mismatch?: boolean
          has_r4_plus?: boolean
          hdec_eng_name?: string | null
          hdec_pic_name?: string | null
          id?: string
          inactive_reason?: string | null
          is_active?: boolean
          is_terminated?: boolean
          latest_rev?: string | null
          latest_status?: string | null
          latest_status_norm?: string | null
          mismatch_fields?: Json
          needs_planning?: boolean
          needs_revise?: boolean
          owner_user_id?: string | null
          plot?: string | null
          r1_dar_actual?: string | null
          r1_dar_plan?: string | null
          r1_draft_finish_actual?: string | null
          r1_draft_finish_plan?: string | null
          r1_draft_start_actual?: string | null
          r1_draft_start_plan?: string | null
          r1_response_result?: string | null
          r1_submission_actual?: string | null
          r1_submission_plan?: string | null
          r2_dar_actual?: string | null
          r2_dar_plan?: string | null
          r2_draft_finish_actual?: string | null
          r2_draft_finish_plan?: string | null
          r2_draft_start_actual?: string | null
          r2_draft_start_plan?: string | null
          r2_response_result?: string | null
          r2_submission_actual?: string | null
          r2_submission_plan?: string | null
          r3_dar_actual?: string | null
          r3_dar_plan?: string | null
          r3_draft_finish_actual?: string | null
          r3_draft_finish_plan?: string | null
          r3_draft_start_actual?: string | null
          r3_draft_start_plan?: string | null
          r3_response_result?: string | null
          r3_submission_actual?: string | null
          r3_submission_plan?: string | null
          raw_payload?: Json
          revise_source_round?: number | null
          row_version?: number
          rs_result_missing?: boolean
          service?: string | null
          sl_no?: number | null
          source_import_log_id?: string | null
          status_group?: string | null
          status_mismatch?: boolean
          team?: string
          updated_at?: string
          updated_by?: string | null
          ur_aging_days?: number | null
        }
        Relationships: []
      }
      abd_settings: {
        Row: {
          ds_gap_after_rs_days: number
          id: string
          rs_plan_gap_days: number
          stuck_ns_days: number
          updated_at: string
          updated_by: string | null
          ur_aging_late_days: number
          ur_aging_warn_days: number
        }
        Insert: {
          ds_gap_after_rs_days?: number
          id?: string
          rs_plan_gap_days?: number
          stuck_ns_days?: number
          updated_at?: string
          updated_by?: string | null
          ur_aging_late_days?: number
          ur_aging_warn_days?: number
        }
        Update: {
          ds_gap_after_rs_days?: number
          id?: string
          rs_plan_gap_days?: number
          stuck_ns_days?: number
          updated_at?: string
          updated_by?: string | null
          ur_aging_late_days?: number
          ur_aging_warn_days?: number
        }
        Relationships: []
      }
      backup_config: {
        Row: {
          id: string
          keep_minimum_count: number
          retention_days: number
          schedule_cron: string
          updated_at: string
        }
        Insert: {
          id?: string
          keep_minimum_count?: number
          retention_days?: number
          schedule_cron?: string
          updated_at?: string
        }
        Update: {
          id?: string
          keep_minimum_count?: number
          retention_days?: number
          schedule_cron?: string
          updated_at?: string
        }
        Relationships: []
      }
      backup_run_log: {
        Row: {
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          metadata: Json | null
          snapshot_id: string | null
          started_at: string
          status: string
        }
        Insert: {
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json | null
          snapshot_id?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json | null
          snapshot_id?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "backup_run_log_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "database_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      database_snapshots: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          is_locked: boolean
          metadata: Json | null
          name: string | null
          sha256_hash: string | null
          size_bytes: number | null
          storage_path: string | null
          tables_included: string[] | null
          trigger_metadata: Json | null
          triggered_by: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_locked?: boolean
          metadata?: Json | null
          name?: string | null
          sha256_hash?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          tables_included?: string[] | null
          trigger_metadata?: Json | null
          triggered_by?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_locked?: boolean
          metadata?: Json | null
          name?: string | null
          sha256_hash?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          tables_included?: string[] | null
          trigger_metadata?: Json | null
          triggered_by?: string
        }
        Relationships: []
      }
      defect_actual_backfill_snapshot_20260722: {
        Row: {
          actual_start_date_old: string | null
          defect_item_id: string
          snapshotted_at: string
        }
        Insert: {
          actual_start_date_old?: string | null
          defect_item_id: string
          snapshotted_at?: string
        }
        Update: {
          actual_start_date_old?: string | null
          defect_item_id?: string
          snapshotted_at?: string
        }
        Relationships: []
      }
      defect_category_team_map: {
        Row: {
          category: string
          created_at: string
          team: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          created_at?: string
          team: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          team?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      defect_comments: {
        Row: {
          author_user_id: string | null
          category: string
          created_at: string
          defect_raw_id: string
          edited: boolean
          id: string
          message: string
          parent_comment_id: string | null
          source: string
          updated_at: string
        }
        Insert: {
          author_user_id?: string | null
          category?: string
          created_at?: string
          defect_raw_id: string
          edited?: boolean
          id?: string
          message: string
          parent_comment_id?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string | null
          category?: string
          created_at?: string
          defect_raw_id?: string
          edited?: boolean
          id?: string
          message?: string
          parent_comment_id?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "defect_comments_defect_raw_id_fkey"
            columns: ["defect_raw_id"]
            isOneToOne: false
            referencedRelation: "defect_items_raw"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "defect_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "defect_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      defect_field_config: {
        Row: {
          created_at: string
          display_name: string
          editable_to_roles: Database["public"]["Enums"]["app_role"][]
          field_name: string
          group_key: string | null
          id: string
          is_visible: boolean
          note: string | null
          origin: string | null
          sort_order: number
          source_label: string | null
          updated_at: string
          updated_by: string | null
          visible_to_roles: Database["public"]["Enums"]["app_role"][]
        }
        Insert: {
          created_at?: string
          display_name: string
          editable_to_roles?: Database["public"]["Enums"]["app_role"][]
          field_name: string
          group_key?: string | null
          id?: string
          is_visible?: boolean
          note?: string | null
          origin?: string | null
          sort_order?: number
          source_label?: string | null
          updated_at?: string
          updated_by?: string | null
          visible_to_roles?: Database["public"]["Enums"]["app_role"][]
        }
        Update: {
          created_at?: string
          display_name?: string
          editable_to_roles?: Database["public"]["Enums"]["app_role"][]
          field_name?: string
          group_key?: string | null
          id?: string
          is_visible?: boolean
          note?: string | null
          origin?: string | null
          sort_order?: number
          source_label?: string | null
          updated_at?: string
          updated_by?: string | null
          visible_to_roles?: Database["public"]["Enums"]["app_role"][]
        }
        Relationships: []
      }
      defect_hdec_pic_rules: {
        Row: {
          building: string
          created_at: string
          hdec_eng: string | null
          hdec_pic: string | null
          id: string
          is_active: boolean
          plot: string
          room_group: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          building: string
          created_at?: string
          hdec_eng?: string | null
          hdec_pic?: string | null
          id?: string
          is_active?: boolean
          plot: string
          room_group: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          building?: string
          created_at?: string
          hdec_eng?: string | null
          hdec_pic?: string | null
          id?: string
          is_active?: boolean
          plot?: string
          room_group?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      defect_header_mappings: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_custom: boolean
          module: string
          note: string | null
          source_header: string
          target_field: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_custom?: boolean
          module?: string
          note?: string | null
          source_header: string
          target_field: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_custom?: boolean
          module?: string
          note?: string | null
          source_header?: string
          target_field?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      defect_import_logs: {
        Row: {
          created_at: string
          data_date: string | null
          errors: Json | null
          file_name: string
          finished_at: string | null
          id: string
          imported_by: string | null
          inserted: number | null
          note: string | null
          rejected: number | null
          rollback_force: boolean | null
          rolled_back_at: string | null
          rolled_back_by: string | null
          sheet_name: string | null
          skipped: number | null
          started_at: string | null
          status: string
          team: string | null
          total_rows: number | null
          updated: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_date?: string | null
          errors?: Json | null
          file_name: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          inserted?: number | null
          note?: string | null
          rejected?: number | null
          rollback_force?: boolean | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          sheet_name?: string | null
          skipped?: number | null
          started_at?: string | null
          status?: string
          team?: string | null
          total_rows?: number | null
          updated?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_date?: string | null
          errors?: Json | null
          file_name?: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          inserted?: number | null
          note?: string | null
          rejected?: number | null
          rollback_force?: boolean | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          sheet_name?: string | null
          skipped?: number | null
          started_at?: string | null
          status?: string
          team?: string | null
          total_rows?: number | null
          updated?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      defect_import_presets: {
        Row: {
          created_at: string
          fields: string[]
          id: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          fields?: string[]
          id?: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          fields?: string[]
          id?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      defect_import_row_logs: {
        Row: {
          action_taken: string | null
          id: string
          processed_at: string
          raw_row_no: number | null
          reason_code: string | null
          reason_detail: string | null
          source_issue_no: string | null
          team: string | null
          upload_id: string
        }
        Insert: {
          action_taken?: string | null
          id?: string
          processed_at?: string
          raw_row_no?: number | null
          reason_code?: string | null
          reason_detail?: string | null
          source_issue_no?: string | null
          team?: string | null
          upload_id: string
        }
        Update: {
          action_taken?: string | null
          id?: string
          processed_at?: string
          raw_row_no?: number | null
          reason_code?: string | null
          reason_detail?: string | null
          source_issue_no?: string | null
          team?: string | null
          upload_id?: string
        }
        Relationships: []
      }
      defect_items_raw: {
        Row: {
          _backfilled_asd_before_20260722: boolean
          aconex_comments: string | null
          actual_closure_date: string | null
          actual_progress_pct: number | null
          actual_rectified_date: string | null
          actual_start_date: string | null
          area_level: string | null
          area_location: string | null
          area_type: string | null
          assigned_to: string | null
          building: string | null
          captured_by_name: string | null
          category: string | null
          classification: string | null
          classification_source: string | null
          classified_at: string | null
          closure_status: string | null
          created_at: string
          created_by_name: string | null
          created_by_team_name: string | null
          created_date: string | null
          critical_marked_at: string | null
          critical_marked_by: string | null
          custom_payload: Json
          data_date: string | null
          defect_location: string | null
          defect_type: string | null
          description: string | null
          due_by: string | null
          forms: string | null
          hdec_comments: string | null
          hdec_eng_name: string | null
          hdec_pic_name: string | null
          hdec_reason: string | null
          hdec_verification: string | null
          hdec_verification_locked: boolean
          id: string
          ir: string | null
          is_active: boolean
          is_critical: boolean
          issue_no: string | null
          item: string | null
          last_updated_at: string | null
          level_name: string | null
          location_raw: string | null
          location_reference: string | null
          main_trade: string | null
          owner_user_id: string | null
          plan_group: string | null
          plan_title: string | null
          planned_closure_date: string | null
          planned_progress_pct: number | null
          planned_rectified_date: string | null
          planned_start_date: string | null
          podium_area: string | null
          priority: string | null
          priority_locked: boolean
          raw_payload: Json
          rectified_status: string | null
          remarks: string | null
          review_flag: string | null
          room: string | null
          room_group: string | null
          row_version: number
          source_import_log_id: string | null
          source_issue_no: string
          status_group: string | null
          status_manual: string | null
          status_raw: string | null
          sub_trade: string | null
          subcontractor_issue_no: string | null
          subcontractor_issue_source: string | null
          subcontractor_name: string | null
          subsub_name: string | null
          team: string
          trade_detail: string | null
          updated_at: string
          updated_by: string | null
          updated_by_name: string | null
          updated_date_raw: string | null
          updated_description: string | null
          updated_status: string | null
          work_type: string | null
        }
        Insert: {
          _backfilled_asd_before_20260722?: boolean
          aconex_comments?: string | null
          actual_closure_date?: string | null
          actual_progress_pct?: number | null
          actual_rectified_date?: string | null
          actual_start_date?: string | null
          area_level?: string | null
          area_location?: string | null
          area_type?: string | null
          assigned_to?: string | null
          building?: string | null
          captured_by_name?: string | null
          category?: string | null
          classification?: string | null
          classification_source?: string | null
          classified_at?: string | null
          closure_status?: string | null
          created_at?: string
          created_by_name?: string | null
          created_by_team_name?: string | null
          created_date?: string | null
          critical_marked_at?: string | null
          critical_marked_by?: string | null
          custom_payload?: Json
          data_date?: string | null
          defect_location?: string | null
          defect_type?: string | null
          description?: string | null
          due_by?: string | null
          forms?: string | null
          hdec_comments?: string | null
          hdec_eng_name?: string | null
          hdec_pic_name?: string | null
          hdec_reason?: string | null
          hdec_verification?: string | null
          hdec_verification_locked?: boolean
          id?: string
          ir?: string | null
          is_active?: boolean
          is_critical?: boolean
          issue_no?: string | null
          item?: string | null
          last_updated_at?: string | null
          level_name?: string | null
          location_raw?: string | null
          location_reference?: string | null
          main_trade?: string | null
          owner_user_id?: string | null
          plan_group?: string | null
          plan_title?: string | null
          planned_closure_date?: string | null
          planned_progress_pct?: number | null
          planned_rectified_date?: string | null
          planned_start_date?: string | null
          podium_area?: string | null
          priority?: string | null
          priority_locked?: boolean
          raw_payload?: Json
          rectified_status?: string | null
          remarks?: string | null
          review_flag?: string | null
          room?: string | null
          room_group?: string | null
          row_version?: number
          source_import_log_id?: string | null
          source_issue_no: string
          status_group?: string | null
          status_manual?: string | null
          status_raw?: string | null
          sub_trade?: string | null
          subcontractor_issue_no?: string | null
          subcontractor_issue_source?: string | null
          subcontractor_name?: string | null
          subsub_name?: string | null
          team: string
          trade_detail?: string | null
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
          updated_date_raw?: string | null
          updated_description?: string | null
          updated_status?: string | null
          work_type?: string | null
        }
        Update: {
          _backfilled_asd_before_20260722?: boolean
          aconex_comments?: string | null
          actual_closure_date?: string | null
          actual_progress_pct?: number | null
          actual_rectified_date?: string | null
          actual_start_date?: string | null
          area_level?: string | null
          area_location?: string | null
          area_type?: string | null
          assigned_to?: string | null
          building?: string | null
          captured_by_name?: string | null
          category?: string | null
          classification?: string | null
          classification_source?: string | null
          classified_at?: string | null
          closure_status?: string | null
          created_at?: string
          created_by_name?: string | null
          created_by_team_name?: string | null
          created_date?: string | null
          critical_marked_at?: string | null
          critical_marked_by?: string | null
          custom_payload?: Json
          data_date?: string | null
          defect_location?: string | null
          defect_type?: string | null
          description?: string | null
          due_by?: string | null
          forms?: string | null
          hdec_comments?: string | null
          hdec_eng_name?: string | null
          hdec_pic_name?: string | null
          hdec_reason?: string | null
          hdec_verification?: string | null
          hdec_verification_locked?: boolean
          id?: string
          ir?: string | null
          is_active?: boolean
          is_critical?: boolean
          issue_no?: string | null
          item?: string | null
          last_updated_at?: string | null
          level_name?: string | null
          location_raw?: string | null
          location_reference?: string | null
          main_trade?: string | null
          owner_user_id?: string | null
          plan_group?: string | null
          plan_title?: string | null
          planned_closure_date?: string | null
          planned_progress_pct?: number | null
          planned_rectified_date?: string | null
          planned_start_date?: string | null
          podium_area?: string | null
          priority?: string | null
          priority_locked?: boolean
          raw_payload?: Json
          rectified_status?: string | null
          remarks?: string | null
          review_flag?: string | null
          room?: string | null
          room_group?: string | null
          row_version?: number
          source_import_log_id?: string | null
          source_issue_no?: string
          status_group?: string | null
          status_manual?: string | null
          status_raw?: string | null
          sub_trade?: string | null
          subcontractor_issue_no?: string | null
          subcontractor_issue_source?: string | null
          subcontractor_name?: string | null
          subsub_name?: string | null
          team?: string
          trade_detail?: string | null
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
          updated_date_raw?: string | null
          updated_description?: string | null
          updated_status?: string | null
          work_type?: string | null
        }
        Relationships: []
      }
      defect_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          defect_raw_id: string
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          source: string
          source_issue_no: string | null
          team: string | null
          upload_id: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          defect_raw_id: string
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string
          source_issue_no?: string | null
          team?: string | null
          upload_id?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          defect_raw_id?: string
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string
          source_issue_no?: string | null
          team?: string | null
          upload_id?: string | null
        }
        Relationships: []
      }
      defect_subcon_rules: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          plot: string
          room_group: string
          sort_order: number
          subcontractor_name: string
          trade_keywords: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          plot: string
          room_group: string
          sort_order?: number
          subcontractor_name: string
          trade_keywords?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          plot?: string
          room_group?: string
          sort_order?: number
          subcontractor_name?: string
          trade_keywords?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      dmr_contractor_master: {
        Row: {
          created_at: string
          discipline_hint: string[] | null
          id: string
          is_active: boolean
          is_direct: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          discipline_hint?: string[] | null
          id?: string
          is_active?: boolean
          is_direct?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          discipline_hint?: string[] | null
          id?: string
          is_active?: boolean
          is_direct?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      dmr_entries: {
        Row: {
          actual_manpower: number | null
          contractor_id: string | null
          contractor_name: string
          created_at: string
          created_by: string | null
          diff_manpower: number | null
          discipline: string
          id: string
          manpower: number | null
          metric: string | null
          plan_manpower: number | null
          plot: string
          report_date: string
          source_image_path: string | null
          system_id: string | null
          system_name: string
          updated_at: string
        }
        Insert: {
          actual_manpower?: number | null
          contractor_id?: string | null
          contractor_name: string
          created_at?: string
          created_by?: string | null
          diff_manpower?: number | null
          discipline: string
          id?: string
          manpower?: number | null
          metric?: string | null
          plan_manpower?: number | null
          plot: string
          report_date: string
          source_image_path?: string | null
          system_id?: string | null
          system_name: string
          updated_at?: string
        }
        Update: {
          actual_manpower?: number | null
          contractor_id?: string | null
          contractor_name?: string
          created_at?: string
          created_by?: string | null
          diff_manpower?: number | null
          discipline?: string
          id?: string
          manpower?: number | null
          metric?: string | null
          plan_manpower?: number | null
          plot?: string
          report_date?: string
          source_image_path?: string | null
          system_id?: string | null
          system_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dmr_entries_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "dmr_contractor_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dmr_entries_discipline_team_master_fkey"
            columns: ["discipline"]
            isOneToOne: false
            referencedRelation: "team_master"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "dmr_entries_system_id_fkey"
            columns: ["system_id"]
            isOneToOne: false
            referencedRelation: "dmr_system_master"
            referencedColumns: ["id"]
          },
        ]
      }
      dmr_system_master: {
        Row: {
          created_at: string
          discipline: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          discipline: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          discipline?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dmr_system_master_discipline_team_master_fkey"
            columns: ["discipline"]
            isOneToOne: false
            referencedRelation: "team_master"
            referencedColumns: ["code"]
          },
        ]
      }
      hdec_eng_name_master: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      hdec_pic_name_master: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_field_logs: {
        Row: {
          applied_value: string | null
          created_at: string
          created_by: string | null
          field_name: string
          id: string
          kind: string
          outcome: string
          previous_value: string | null
          raw_row_no: number | null
          raw_value: string | null
          reason_code: string | null
          reason_detail: string | null
          row_log_id: string | null
          upload_id: string
        }
        Insert: {
          applied_value?: string | null
          created_at?: string
          created_by?: string | null
          field_name: string
          id?: string
          kind: string
          outcome: string
          previous_value?: string | null
          raw_row_no?: number | null
          raw_value?: string | null
          reason_code?: string | null
          reason_detail?: string | null
          row_log_id?: string | null
          upload_id: string
        }
        Update: {
          applied_value?: string | null
          created_at?: string
          created_by?: string | null
          field_name?: string
          id?: string
          kind?: string
          outcome?: string
          previous_value?: string | null
          raw_row_no?: number | null
          raw_value?: string | null
          reason_code?: string | null
          reason_detail?: string | null
          row_log_id?: string | null
          upload_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          hdec_eng_name: string | null
          hdec_pic_name: string | null
          id: string
          is_active: boolean
          login_id: string
          must_change_password: boolean
          name: string | null
          subcontractor_name: string | null
          subsub_name: string | null
          team: string | null
          updated_at: string
          user_type: Database["public"]["Enums"]["user_type"]
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          hdec_eng_name?: string | null
          hdec_pic_name?: string | null
          id: string
          is_active?: boolean
          login_id: string
          must_change_password?: boolean
          name?: string | null
          subcontractor_name?: string | null
          subsub_name?: string | null
          team?: string | null
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"]
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          hdec_eng_name?: string | null
          hdec_pic_name?: string | null
          id?: string
          is_active?: boolean
          login_id?: string
          must_change_password?: boolean
          name?: string | null
          subcontractor_name?: string | null
          subsub_name?: string | null
          team?: string | null
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"]
        }
        Relationships: []
      }
      restore_run_log: {
        Row: {
          destructive: boolean
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          initiated_by: string | null
          metadata: Json | null
          restored_tables: string[] | null
          snapshot_id: string | null
          started_at: string
          status: string
        }
        Insert: {
          destructive?: boolean
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string | null
          metadata?: Json | null
          restored_tables?: string[] | null
          snapshot_id?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          destructive?: boolean
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string | null
          metadata?: Json | null
          restored_tables?: string[] | null
          snapshot_id?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "restore_run_log_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "database_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      spare_part_change_log: {
        Row: {
          change_source: string
          changed_at: string
          changed_by: string | null
          changed_field: string
          doc_ref: string
          id: string
          new_value: string | null
          old_value: string | null
          upload_id: string | null
        }
        Insert: {
          change_source?: string
          changed_at?: string
          changed_by?: string | null
          changed_field: string
          doc_ref: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          upload_id?: string | null
        }
        Update: {
          change_source?: string
          changed_at?: string
          changed_by?: string | null
          changed_field?: string
          doc_ref?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spare_part_change_log_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "spare_parts_import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      spare_part_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          doc_ref: string
          id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          doc_ref: string
          id?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          doc_ref?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spare_part_comments_doc_ref_fkey"
            columns: ["doc_ref"]
            isOneToOne: false
            referencedRelation: "spare_parts_raw"
            referencedColumns: ["doc_ref"]
          },
        ]
      }
      spare_part_custom_fields: {
        Row: {
          created_at: string
          created_by: string | null
          data_type: string
          display_name: string
          field_name: string
          id: string
          is_enabled: boolean
          module: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data_type?: string
          display_name: string
          field_name: string
          id?: string
          is_enabled?: boolean
          module?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data_type?: string
          display_name?: string
          field_name?: string
          id?: string
          is_enabled?: boolean
          module?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      spare_part_field_config: {
        Row: {
          display_name: string
          editable_to_roles: Database["public"]["Enums"]["app_role"][]
          field_name: string
          group_key: string | null
          id: string
          is_visible: boolean
          note: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
          visible_to_roles: Database["public"]["Enums"]["app_role"][]
        }
        Insert: {
          display_name: string
          editable_to_roles?: Database["public"]["Enums"]["app_role"][]
          field_name: string
          group_key?: string | null
          id?: string
          is_visible?: boolean
          note?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          visible_to_roles?: Database["public"]["Enums"]["app_role"][]
        }
        Update: {
          display_name?: string
          editable_to_roles?: Database["public"]["Enums"]["app_role"][]
          field_name?: string
          group_key?: string | null
          id?: string
          is_visible?: boolean
          note?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          visible_to_roles?: Database["public"]["Enums"]["app_role"][]
        }
        Relationships: []
      }
      spare_part_header_mappings: {
        Row: {
          id: string
          is_active: boolean
          is_custom: boolean
          module: string
          note: string | null
          source_header: string
          target_field: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          is_active?: boolean
          is_custom?: boolean
          module?: string
          note?: string | null
          source_header: string
          target_field: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          is_active?: boolean
          is_custom?: boolean
          module?: string
          note?: string | null
          source_header?: string
          target_field?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      spare_part_import_row_logs: {
        Row: {
          action_taken: string
          doc_ref: string | null
          id: string
          processed_at: string
          raw_row_no: number | null
          reason_code: string | null
          reason_detail: string | null
          upload_id: string
        }
        Insert: {
          action_taken: string
          doc_ref?: string | null
          id?: string
          processed_at?: string
          raw_row_no?: number | null
          reason_code?: string | null
          reason_detail?: string | null
          upload_id: string
        }
        Update: {
          action_taken?: string
          doc_ref?: string | null
          id?: string
          processed_at?: string
          raw_row_no?: number | null
          reason_code?: string | null
          reason_detail?: string | null
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spare_part_import_row_logs_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "spare_parts_import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      spare_part_status_history: {
        Row: {
          author_user_id: string | null
          category: string
          created_at: string
          doc_ref: string
          edited: boolean
          id: string
          message: string
          parent_comment_id: string | null
          source: string
          source_file_hash: string | null
          updated_at: string
        }
        Insert: {
          author_user_id?: string | null
          category: string
          created_at?: string
          doc_ref: string
          edited?: boolean
          id?: string
          message: string
          parent_comment_id?: string | null
          source?: string
          source_file_hash?: string | null
          updated_at?: string
        }
        Update: {
          author_user_id?: string | null
          category?: string
          created_at?: string
          doc_ref?: string
          edited?: boolean
          id?: string
          message?: string
          parent_comment_id?: string | null
          source?: string
          source_file_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spare_part_status_history_doc_ref_fkey"
            columns: ["doc_ref"]
            isOneToOne: false
            referencedRelation: "spare_parts_raw"
            referencedColumns: ["doc_ref"]
          },
          {
            foreignKeyName: "spare_part_status_history_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "spare_part_status_history"
            referencedColumns: ["id"]
          },
        ]
      }
      spare_part_status_mapping: {
        Row: {
          approval_code: string
          approval_status: string
          source_status_raw: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approval_code: string
          approval_status: string
          source_status_raw: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approval_code?: string
          approval_status?: string
          source_status_raw?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      spare_parts_import_logs: {
        Row: {
          data_date: string | null
          duration_ms: number | null
          error_message: string | null
          excluded_headers: string[] | null
          executed_at: string
          executed_by: string | null
          file_hash: string | null
          file_name: string
          file_size: number | null
          header_map: Json | null
          header_row: number | null
          id: string
          module: string
          note: string | null
          rollback_force: boolean
          rolled_back_at: string | null
          rolled_back_by: string | null
          row_counts: Json | null
          sheet_name: string | null
          source_type: string
          status: string
          unknown_headers: string[] | null
          validation: Json | null
          warnings: Json | null
        }
        Insert: {
          data_date?: string | null
          duration_ms?: number | null
          error_message?: string | null
          excluded_headers?: string[] | null
          executed_at?: string
          executed_by?: string | null
          file_hash?: string | null
          file_name: string
          file_size?: number | null
          header_map?: Json | null
          header_row?: number | null
          id?: string
          module?: string
          note?: string | null
          rollback_force?: boolean
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          row_counts?: Json | null
          sheet_name?: string | null
          source_type?: string
          status?: string
          unknown_headers?: string[] | null
          validation?: Json | null
          warnings?: Json | null
        }
        Update: {
          data_date?: string | null
          duration_ms?: number | null
          error_message?: string | null
          excluded_headers?: string[] | null
          executed_at?: string
          executed_by?: string | null
          file_hash?: string | null
          file_name?: string
          file_size?: number | null
          header_map?: Json | null
          header_row?: number | null
          id?: string
          module?: string
          note?: string | null
          rollback_force?: boolean
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          row_counts?: Json | null
          sheet_name?: string | null
          source_type?: string
          status?: string
          unknown_headers?: string[] | null
          validation?: Json | null
          warnings?: Json | null
        }
        Relationships: []
      }
      spare_parts_raw: {
        Row: {
          action: string | null
          approval_code: string | null
          approval_status: string | null
          availability_10y: string | null
          category: string | null
          cert_available: boolean | null
          cost_impact: string | null
          cost_impact_qar: number | null
          cost_impact_usd: number | null
          cost_note: string | null
          cost_qar: number | null
          cost_usd: number | null
          custom_payload: Json | null
          delivery_date: string | null
          delivery_done: boolean | null
          delivery_progress: number | null
          delivery_status: string | null
          delivery_target: string | null
          discipline: string | null
          doc_others: string | null
          doc_ref: string
          drawing_available: boolean | null
          imported_at: string
          is_active: boolean
          is_duplicate: boolean | null
          issue_action: string | null
          issue_flag: string | null
          issue_owner: string | null
          manual_available: boolean | null
          manufacturer: string | null
          owner_user_id: string | null
          phy: boolean | null
          physical_list_agreed: boolean | null
          physical_remarks: string | null
          plot: string
          po_date: string | null
          po_done: boolean | null
          po_number: string | null
          po_progress: number | null
          po_target: string | null
          proc_category: string | null
          proc_remarks: string | null
          qty_delivered: number | null
          qty_total: number | null
          quotation_done: boolean | null
          quotation_progress: number | null
          quotation_target: string | null
          raw_payload: Json | null
          rec_letter_2y: string | null
          rec_letter_5y: string | null
          remarks: string | null
          req_notes: string | null
          req_qty: number | null
          req_unit: string | null
          revision: string | null
          rfq_progress: number | null
          row_version: number
          source_import_log_id: string | null
          spec_available: boolean | null
          spl_approval_date: string | null
          spl_list_approved: boolean | null
          spl_list_code: string | null
          spl_list_target: string | null
          spl_req_contract: string | null
          spl_req_hdec: string | null
          spl_req_mmjv: string | null
          stage1_date: string | null
          stage1_done: boolean | null
          stage2_date: string | null
          stage2_done: boolean | null
          stage2_progress: number | null
          stage3_date: string | null
          stage3_done: boolean | null
          stage3_progress: number | null
          stage4_date: string | null
          stage4_done: boolean | null
          stage4_progress: number | null
          subject: string | null
          supplier: string | null
          system_type: string | null
          team: string | null
          updated_at: string
          updated_by: string | null
          warranty_available: boolean | null
        }
        Insert: {
          action?: string | null
          approval_code?: string | null
          approval_status?: string | null
          availability_10y?: string | null
          category?: string | null
          cert_available?: boolean | null
          cost_impact?: string | null
          cost_impact_qar?: number | null
          cost_impact_usd?: number | null
          cost_note?: string | null
          cost_qar?: number | null
          cost_usd?: number | null
          custom_payload?: Json | null
          delivery_date?: string | null
          delivery_done?: boolean | null
          delivery_progress?: number | null
          delivery_status?: string | null
          delivery_target?: string | null
          discipline?: string | null
          doc_others?: string | null
          doc_ref: string
          drawing_available?: boolean | null
          imported_at?: string
          is_active?: boolean
          is_duplicate?: boolean | null
          issue_action?: string | null
          issue_flag?: string | null
          issue_owner?: string | null
          manual_available?: boolean | null
          manufacturer?: string | null
          owner_user_id?: string | null
          phy?: boolean | null
          physical_list_agreed?: boolean | null
          physical_remarks?: string | null
          plot: string
          po_date?: string | null
          po_done?: boolean | null
          po_number?: string | null
          po_progress?: number | null
          po_target?: string | null
          proc_category?: string | null
          proc_remarks?: string | null
          qty_delivered?: number | null
          qty_total?: number | null
          quotation_done?: boolean | null
          quotation_progress?: number | null
          quotation_target?: string | null
          raw_payload?: Json | null
          rec_letter_2y?: string | null
          rec_letter_5y?: string | null
          remarks?: string | null
          req_notes?: string | null
          req_qty?: number | null
          req_unit?: string | null
          revision?: string | null
          rfq_progress?: number | null
          row_version?: number
          source_import_log_id?: string | null
          spec_available?: boolean | null
          spl_approval_date?: string | null
          spl_list_approved?: boolean | null
          spl_list_code?: string | null
          spl_list_target?: string | null
          spl_req_contract?: string | null
          spl_req_hdec?: string | null
          spl_req_mmjv?: string | null
          stage1_date?: string | null
          stage1_done?: boolean | null
          stage2_date?: string | null
          stage2_done?: boolean | null
          stage2_progress?: number | null
          stage3_date?: string | null
          stage3_done?: boolean | null
          stage3_progress?: number | null
          stage4_date?: string | null
          stage4_done?: boolean | null
          stage4_progress?: number | null
          subject?: string | null
          supplier?: string | null
          system_type?: string | null
          team?: string | null
          updated_at?: string
          updated_by?: string | null
          warranty_available?: boolean | null
        }
        Update: {
          action?: string | null
          approval_code?: string | null
          approval_status?: string | null
          availability_10y?: string | null
          category?: string | null
          cert_available?: boolean | null
          cost_impact?: string | null
          cost_impact_qar?: number | null
          cost_impact_usd?: number | null
          cost_note?: string | null
          cost_qar?: number | null
          cost_usd?: number | null
          custom_payload?: Json | null
          delivery_date?: string | null
          delivery_done?: boolean | null
          delivery_progress?: number | null
          delivery_status?: string | null
          delivery_target?: string | null
          discipline?: string | null
          doc_others?: string | null
          doc_ref?: string
          drawing_available?: boolean | null
          imported_at?: string
          is_active?: boolean
          is_duplicate?: boolean | null
          issue_action?: string | null
          issue_flag?: string | null
          issue_owner?: string | null
          manual_available?: boolean | null
          manufacturer?: string | null
          owner_user_id?: string | null
          phy?: boolean | null
          physical_list_agreed?: boolean | null
          physical_remarks?: string | null
          plot?: string
          po_date?: string | null
          po_done?: boolean | null
          po_number?: string | null
          po_progress?: number | null
          po_target?: string | null
          proc_category?: string | null
          proc_remarks?: string | null
          qty_delivered?: number | null
          qty_total?: number | null
          quotation_done?: boolean | null
          quotation_progress?: number | null
          quotation_target?: string | null
          raw_payload?: Json | null
          rec_letter_2y?: string | null
          rec_letter_5y?: string | null
          remarks?: string | null
          req_notes?: string | null
          req_qty?: number | null
          req_unit?: string | null
          revision?: string | null
          rfq_progress?: number | null
          row_version?: number
          source_import_log_id?: string | null
          spec_available?: boolean | null
          spl_approval_date?: string | null
          spl_list_approved?: boolean | null
          spl_list_code?: string | null
          spl_list_target?: string | null
          spl_req_contract?: string | null
          spl_req_hdec?: string | null
          spl_req_mmjv?: string | null
          stage1_date?: string | null
          stage1_done?: boolean | null
          stage2_date?: string | null
          stage2_done?: boolean | null
          stage2_progress?: number | null
          stage3_date?: string | null
          stage3_done?: boolean | null
          stage3_progress?: number | null
          stage4_date?: string | null
          stage4_done?: boolean | null
          stage4_progress?: number | null
          subject?: string | null
          supplier?: string | null
          system_type?: string | null
          team?: string | null
          updated_at?: string
          updated_by?: string | null
          warranty_available?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "spare_parts_raw_source_import_log_id_fkey"
            columns: ["source_import_log_id"]
            isOneToOne: false
            referencedRelation: "spare_parts_import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      spare_parts_sync_log: {
        Row: {
          applied: boolean
          changed: number | null
          changes_detail: Json | null
          db_uncovered: number | null
          dp_held: number | null
          executed_at: string
          executed_by: string | null
          file_hash: string | null
          file_name: string
          generated_on: string | null
          id: string
          matched: number | null
          plots: string[] | null
          unchanged: number | null
          unmatched_export: number | null
        }
        Insert: {
          applied?: boolean
          changed?: number | null
          changes_detail?: Json | null
          db_uncovered?: number | null
          dp_held?: number | null
          executed_at?: string
          executed_by?: string | null
          file_hash?: string | null
          file_name: string
          generated_on?: string | null
          id?: string
          matched?: number | null
          plots?: string[] | null
          unchanged?: number | null
          unmatched_export?: number | null
        }
        Update: {
          applied?: boolean
          changed?: number | null
          changes_detail?: Json | null
          db_uncovered?: number | null
          dp_held?: number | null
          executed_at?: string
          executed_by?: string | null
          file_hash?: string | null
          file_name?: string
          generated_on?: string | null
          id?: string
          matched?: number | null
          plots?: string[] | null
          unchanged?: number | null
          unmatched_export?: number | null
        }
        Relationships: []
      }
      subcontractor_master: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          owner_code: string | null
          parent_subcontractor_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          owner_code?: string | null
          parent_subcontractor_id?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          owner_code?: string | null
          parent_subcontractor_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcontractor_master_parent_subcontractor_id_fkey"
            columns: ["parent_subcontractor_id"]
            isOneToOne: false
            referencedRelation: "subcontractor_master"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_user_id: string | null
          category: string | null
          created_at: string
          edited: boolean
          id: string
          message: string
          parent_comment_id: string | null
          source: string
          task_raw_id: string
          updated_at: string
        }
        Insert: {
          author_user_id?: string | null
          category?: string | null
          created_at?: string
          edited?: boolean
          id?: string
          message: string
          parent_comment_id?: string | null
          source?: string
          task_raw_id: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string | null
          category?: string | null
          created_at?: string
          edited?: boolean
          id?: string
          message?: string
          parent_comment_id?: string | null
          source?: string
          task_raw_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "task_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_raw_id_fkey"
            columns: ["task_raw_id"]
            isOneToOne: false
            referencedRelation: "task_management_raw"
            referencedColumns: ["id"]
          },
        ]
      }
      task_management_field_config: {
        Row: {
          created_at: string
          display_name: string
          editable_to_roles: Database["public"]["Enums"]["app_role"][]
          field_name: string
          group_key: string | null
          id: string
          is_visible: boolean
          note: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
          visible_to_roles: Database["public"]["Enums"]["app_role"][]
        }
        Insert: {
          created_at?: string
          display_name: string
          editable_to_roles?: Database["public"]["Enums"]["app_role"][]
          field_name: string
          group_key?: string | null
          id?: string
          is_visible?: boolean
          note?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          visible_to_roles?: Database["public"]["Enums"]["app_role"][]
        }
        Update: {
          created_at?: string
          display_name?: string
          editable_to_roles?: Database["public"]["Enums"]["app_role"][]
          field_name?: string
          group_key?: string | null
          id?: string
          is_visible?: boolean
          note?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          visible_to_roles?: Database["public"]["Enums"]["app_role"][]
        }
        Relationships: []
      }
      task_management_header_mappings: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_custom: boolean
          module: string
          note: string | null
          source_header: string
          target_field: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_custom?: boolean
          module?: string
          note?: string | null
          source_header: string
          target_field: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_custom?: boolean
          module?: string
          note?: string | null
          source_header?: string
          target_field?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      task_management_import_logs: {
        Row: {
          created_at: string
          data_date: string | null
          discipline: string
          errors: Json | null
          file_name: string
          finished_at: string | null
          id: string
          imported_by: string | null
          inserted: number
          note: string | null
          rejected: number
          rollback_force: boolean
          rolled_back_at: string | null
          rolled_back_by: string | null
          sheet_name: string | null
          skipped: number
          started_at: string
          status: string
          total_rows: number
          updated: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_date?: string | null
          discipline: string
          errors?: Json | null
          file_name: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          inserted?: number
          note?: string | null
          rejected?: number
          rollback_force?: boolean
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          sheet_name?: string | null
          skipped?: number
          started_at?: string
          status?: string
          total_rows?: number
          updated?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_date?: string | null
          discipline?: string
          errors?: Json | null
          file_name?: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          inserted?: number
          note?: string | null
          rejected?: number
          rollback_force?: boolean
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          sheet_name?: string | null
          skipped?: number
          started_at?: string
          status?: string
          total_rows?: number
          updated?: number
          updated_at?: string
        }
        Relationships: []
      }
      task_management_import_row_logs: {
        Row: {
          action_taken: string
          discipline: string | null
          id: string
          processed_at: string
          raw_row_no: number | null
          reason_code: string | null
          reason_detail: string | null
          task_no: string | null
          upload_id: string
        }
        Insert: {
          action_taken: string
          discipline?: string | null
          id?: string
          processed_at?: string
          raw_row_no?: number | null
          reason_code?: string | null
          reason_detail?: string | null
          task_no?: string | null
          upload_id: string
        }
        Update: {
          action_taken?: string
          discipline?: string | null
          id?: string
          processed_at?: string
          raw_row_no?: number | null
          reason_code?: string | null
          reason_detail?: string | null
          task_no?: string | null
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_management_import_row_logs_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "task_management_import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      task_management_raw: {
        Row: {
          actual_duration: number | null
          actual_finish: string | null
          actual_progress: number | null
          actual_start: string | null
          alarm_reason: string | null
          auto_judgment: string | null
          auto_judgment_import: string | null
          category: string | null
          created_at: string
          cum_actual_pct: number | null
          cum_plan_pct: number | null
          data_date: string
          delay_days: number | null
          discipline: string
          floor_level: string | null
          forecast_end: string | null
          gap_pct: number | null
          hdec_eng_name: string | null
          hdec_pic_name: string | null
          id: string
          imported_at: string
          imported_by: string | null
          is_active: boolean
          is_rollup: boolean
          level: string
          location: string | null
          main_task_no: string | null
          owner_user_id: string | null
          plan_days: number | null
          plan_end: string | null
          plan_progress: number | null
          plan_start: string | null
          plot: string | null
          progress_variance: number | null
          risk: string | null
          row_type: string | null
          slip_days: number | null
          sort_order: number | null
          source_file: string | null
          source_import_log_id: string | null
          status_manual: string | null
          sub_task_desc: string | null
          task_name: string | null
          task_no: string
          team: string | null
          updated_at: string
        }
        Insert: {
          actual_duration?: number | null
          actual_finish?: string | null
          actual_progress?: number | null
          actual_start?: string | null
          alarm_reason?: string | null
          auto_judgment?: string | null
          auto_judgment_import?: string | null
          category?: string | null
          created_at?: string
          cum_actual_pct?: number | null
          cum_plan_pct?: number | null
          data_date: string
          delay_days?: number | null
          discipline: string
          floor_level?: string | null
          forecast_end?: string | null
          gap_pct?: number | null
          hdec_eng_name?: string | null
          hdec_pic_name?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          is_active?: boolean
          is_rollup?: boolean
          level: string
          location?: string | null
          main_task_no?: string | null
          owner_user_id?: string | null
          plan_days?: number | null
          plan_end?: string | null
          plan_progress?: number | null
          plan_start?: string | null
          plot?: string | null
          progress_variance?: number | null
          risk?: string | null
          row_type?: string | null
          slip_days?: number | null
          sort_order?: number | null
          source_file?: string | null
          source_import_log_id?: string | null
          status_manual?: string | null
          sub_task_desc?: string | null
          task_name?: string | null
          task_no: string
          team?: string | null
          updated_at?: string
        }
        Update: {
          actual_duration?: number | null
          actual_finish?: string | null
          actual_progress?: number | null
          actual_start?: string | null
          alarm_reason?: string | null
          auto_judgment?: string | null
          auto_judgment_import?: string | null
          category?: string | null
          created_at?: string
          cum_actual_pct?: number | null
          cum_plan_pct?: number | null
          data_date?: string
          delay_days?: number | null
          discipline?: string
          floor_level?: string | null
          forecast_end?: string | null
          gap_pct?: number | null
          hdec_eng_name?: string | null
          hdec_pic_name?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          is_active?: boolean
          is_rollup?: boolean
          level?: string
          location?: string | null
          main_task_no?: string | null
          owner_user_id?: string | null
          plan_days?: number | null
          plan_end?: string | null
          plan_progress?: number | null
          plan_start?: string | null
          plot?: string | null
          progress_variance?: number | null
          risk?: string | null
          row_type?: string | null
          slip_days?: number | null
          sort_order?: number | null
          source_file?: string | null
          source_import_log_id?: string | null
          status_manual?: string | null
          sub_task_desc?: string | null
          task_name?: string | null
          task_no?: string
          team?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_management_raw_source_import_log_id_fkey"
            columns: ["source_import_log_id"]
            isOneToOne: false
            referencedRelation: "task_management_import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      task_management_settings: {
        Row: {
          caution_gap_buffer: number
          id: string
          updated_at: string
          updated_by: string | null
          worsen_gap: number
        }
        Insert: {
          caution_gap_buffer?: number
          id?: string
          updated_at?: string
          updated_by?: string | null
          worsen_gap?: number
        }
        Update: {
          caution_gap_buffer?: number
          id?: string
          updated_at?: string
          updated_by?: string | null
          worsen_gap?: number
        }
        Relationships: []
      }
      task_management_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          discipline: string
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          source: string
          task_no: string
          task_raw_id: string | null
          upload_id: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          discipline: string
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string
          task_no: string
          task_raw_id?: string | null
          upload_id?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          discipline?: string
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string
          task_no?: string
          task_raw_id?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_management_status_history_task_raw_id_fkey"
            columns: ["task_raw_id"]
            isOneToOne: false
            referencedRelation: "task_management_raw"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_management_status_history_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "task_management_import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      task_progress_chart_cache: {
        Row: {
          actual_points: Json
          discipline: string
          id: string
          last_actual_at_dd: number | null
          last_actual_progress: number | null
          last_plan_at_dd: number | null
          last_plan_progress: number | null
          plan_points: Json
          task_no: string
          updated_at: string
          x_end: string | null
          x_start: string | null
        }
        Insert: {
          actual_points?: Json
          discipline: string
          id?: string
          last_actual_at_dd?: number | null
          last_actual_progress?: number | null
          last_plan_at_dd?: number | null
          last_plan_progress?: number | null
          plan_points?: Json
          task_no: string
          updated_at?: string
          x_end?: string | null
          x_start?: string | null
        }
        Update: {
          actual_points?: Json
          discipline?: string
          id?: string
          last_actual_at_dd?: number | null
          last_actual_progress?: number | null
          last_plan_at_dd?: number | null
          last_plan_progress?: number | null
          plan_points?: Json
          task_no?: string
          updated_at?: string
          x_end?: string | null
          x_start?: string | null
        }
        Relationships: []
      }
      task_schedule_change_audit: {
        Row: {
          created_at: string
          created_by: string | null
          discipline: string | null
          forecast_end_diff_days: number | null
          forecast_end_new_date: string | null
          forecast_end_old_date: string | null
          forecast_end_prev_gap_days: number | null
          hdec_eng_name: string | null
          hdec_pic_name: string | null
          id: string
          import_log_id: string | null
          main_task_no: string | null
          plan_end_cur_gap_days: number | null
          plan_end_diff_days: number | null
          plan_end_new_date: string | null
          plan_end_old_date: string | null
          plan_end_prev_gap_days: number | null
          plan_start_cur_gap_days: number | null
          plan_start_diff_days: number | null
          plan_start_new_date: string | null
          plan_start_old_date: string | null
          plan_start_prev_gap_days: number | null
          plot: string | null
          raw_row_no: number | null
          source_file: string | null
          task_name: string | null
          task_no: string
          task_raw_id: string | null
          team: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          discipline?: string | null
          forecast_end_diff_days?: number | null
          forecast_end_new_date?: string | null
          forecast_end_old_date?: string | null
          forecast_end_prev_gap_days?: number | null
          hdec_eng_name?: string | null
          hdec_pic_name?: string | null
          id?: string
          import_log_id?: string | null
          main_task_no?: string | null
          plan_end_cur_gap_days?: number | null
          plan_end_diff_days?: number | null
          plan_end_new_date?: string | null
          plan_end_old_date?: string | null
          plan_end_prev_gap_days?: number | null
          plan_start_cur_gap_days?: number | null
          plan_start_diff_days?: number | null
          plan_start_new_date?: string | null
          plan_start_old_date?: string | null
          plan_start_prev_gap_days?: number | null
          plot?: string | null
          raw_row_no?: number | null
          source_file?: string | null
          task_name?: string | null
          task_no: string
          task_raw_id?: string | null
          team?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          discipline?: string | null
          forecast_end_diff_days?: number | null
          forecast_end_new_date?: string | null
          forecast_end_old_date?: string | null
          forecast_end_prev_gap_days?: number | null
          hdec_eng_name?: string | null
          hdec_pic_name?: string | null
          id?: string
          import_log_id?: string | null
          main_task_no?: string | null
          plan_end_cur_gap_days?: number | null
          plan_end_diff_days?: number | null
          plan_end_new_date?: string | null
          plan_end_old_date?: string | null
          plan_end_prev_gap_days?: number | null
          plan_start_cur_gap_days?: number | null
          plan_start_diff_days?: number | null
          plan_start_new_date?: string | null
          plan_start_old_date?: string | null
          plan_start_prev_gap_days?: number | null
          plot?: string | null
          raw_row_no?: number | null
          source_file?: string | null
          task_name?: string | null
          task_no?: string
          task_raw_id?: string | null
          team?: string | null
        }
        Relationships: []
      }
      team_master: {
        Row: {
          aliases: string[]
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_view_preferences: {
        Row: {
          created_at: string
          state: Json
          updated_at: string
          user_id: string
          view_key: string
        }
        Insert: {
          created_at?: string
          state?: Json
          updated_at?: string
          user_id: string
          view_key: string
        }
        Update: {
          created_at?: string
          state?: Json
          updated_at?: string
          user_id?: string
          view_key?: string
        }
        Relationships: []
      }
    }
    Views: {
      hdec_eng_master: {
        Row: {
          created_at: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      hdec_pic_master: {
        Row: {
          created_at: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          updated_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _snag_dim_val: {
        Args: {
          _dim: string
          _row: Database["public"]["Tables"]["defect_items_raw"]["Row"]
        }
        Returns: string
      }
      _snag_group_val: {
        Args: {
          _dim: string
          _row: Database["public"]["Tables"]["defect_items_raw"]["Row"]
        }
        Returns: string
      }
      _snag_progress_norm: { Args: { _v: number }; Returns: number }
      _snag_stage_actual_date: {
        Args: {
          _row: Database["public"]["Tables"]["defect_items_raw"]["Row"]
          _stage: string
        }
        Returns: string
      }
      _snag_stage_done: {
        Args: {
          _row: Database["public"]["Tables"]["defect_items_raw"]["Row"]
          _stage: string
        }
        Returns: boolean
      }
      _snag_stage_planned_date: {
        Args: {
          _row: Database["public"]["Tables"]["defect_items_raw"]["Row"]
          _stage: string
        }
        Returns: string
      }
      abd_aconex_apply_diffs: {
        Args: { _batch_id: string; _patches: Json }
        Returns: number
      }
      abd_approved_round: {
        Args: { _row: Database["public"]["Tables"]["abd_items_raw"]["Row"] }
        Returns: number
      }
      abd_dashboard_approval_trend:
        | {
            Args: { _months?: number; _plots?: string[]; _teams?: string[] }
            Returns: {
              approved_cnt: number
              month_start: string
              team: string
            }[]
          }
        | {
            Args: {
              _batch_no?: string[]
              _months?: number
              _plots?: string[]
              _teams?: string[]
            }
            Returns: {
              approved_cnt: number
              month_start: string
              team: string
            }[]
          }
      abd_dashboard_attention_lists:
        | {
            Args: { _limit?: number; _plots?: string[]; _teams?: string[] }
            Returns: {
              abd_number: string
              current_stage: string
              document_title: string
              hdec_pic_name: string
              id: string
              latest_status: string
              list_kind: string
              plot: string
              team: string
              ur_aging_days: number
            }[]
          }
        | {
            Args: {
              _batch_no?: string[]
              _limit?: number
              _plots?: string[]
              _teams?: string[]
            }
            Returns: {
              abd_number: string
              current_stage: string
              document_title: string
              hdec_pic_name: string
              id: string
              latest_status: string
              list_kind: string
              plot: string
              team: string
              ur_aging_days: number
            }[]
          }
      abd_dashboard_crosscut:
        | {
            Args: { _plots?: string[]; _teams?: string[] }
            Returns: {
              bucket: string
              cnt: number
              dis: string
              service: string
            }[]
          }
        | {
            Args: { _batch_no?: string[]; _plots?: string[]; _teams?: string[] }
            Returns: {
              bucket: string
              cnt: number
              dis: string
              service: string
            }[]
          }
      abd_dashboard_judgment_mix: {
        Args: { _batch_no?: string[]; _plots?: string[] }
        Returns: {
          approved: number
          caution: number
          critical: number
          delayed: number
          normal: number
          stage: string
          total: number
        }[]
      }
      abd_dashboard_overdue_heatmap:
        | {
            Args: { _plots?: string[]; _teams?: string[] }
            Returns: {
              bucket: string
              cnt: number
              team: string
            }[]
          }
        | {
            Args: { _batch_no?: string[]; _plots?: string[]; _teams?: string[] }
            Returns: {
              bucket: string
              cnt: number
              team: string
            }[]
          }
      abd_dashboard_row1:
        | {
            Args: { _plots?: string[]; _teams?: string[] }
            Returns: {
              bucket: string
              cnt: number
              team: string
            }[]
          }
        | {
            Args: { _batch_no?: string[]; _plots?: string[]; _teams?: string[] }
            Returns: {
              bucket: string
              cnt: number
              team: string
            }[]
          }
      abd_dashboard_row2:
        | {
            Args: { _plots?: string[]; _teams?: string[] }
            Returns: {
              bucket: string
              cnt: number
              team: string
            }[]
          }
        | {
            Args: { _batch_no?: string[]; _plots?: string[]; _teams?: string[] }
            Returns: {
              bucket: string
              cnt: number
              team: string
            }[]
          }
      abd_dashboard_status_dist:
        | {
            Args: { _plots?: string[]; _teams?: string[] }
            Returns: {
              cnt: number
              status: string
            }[]
          }
        | {
            Args: { _batch_no?: string[]; _plots?: string[]; _teams?: string[] }
            Returns: {
              cnt: number
              status: string
            }[]
          }
      abd_items_by_numbers: {
        Args: { _nums: string[] }
        Returns: {
          abd_number: string
          active_round: number
          is_terminated: boolean
          latest_status: string
          latest_status_norm: string
          r1_dar_actual: string
          r1_draft_finish_actual: string
          r1_draft_finish_plan: string
          r1_draft_start_actual: string
          r1_draft_start_plan: string
          r1_response_result: string
          r1_submission_actual: string
          r2_dar_actual: string
          r2_draft_finish_actual: string
          r2_draft_finish_plan: string
          r2_draft_start_actual: string
          r2_draft_start_plan: string
          r2_response_result: string
          r2_submission_actual: string
          r3_dar_actual: string
          r3_draft_finish_actual: string
          r3_draft_finish_plan: string
          r3_draft_start_actual: string
          r3_draft_start_plan: string
          r3_response_result: string
          r3_submission_actual: string
        }[]
      }
      abd_items_counts: {
        Args: { _include_inactive?: boolean; _plot?: string; _team?: string }
        Returns: {
          approved_count: number
          excluded_count: number
          in_progress_count: number
          latest_data_date: string
          not_started_count: number
          total_count: number
        }[]
      }
      abd_items_facets: {
        Args: {
          _column: string
          _filters?: Json
          _include_inactive?: boolean
          _limit?: number
          _plot?: string
          _q?: string
          _status_group?: string
          _team?: string
        }
        Returns: {
          cnt: number
          value: string
        }[]
      }
      abd_items_search: {
        Args: {
          _excluded_mode?: string
          _filters?: Json
          _include_inactive?: boolean
          _limit?: number
          _offset?: number
          _plot?: string
          _q?: string
          _sort?: Json
          _status_group?: string
          _team?: string
        }
        Returns: {
          rows: Json
          total_count: number
        }[]
      }
      abd_judge_at_date: {
        Args: { _as_of?: string; _ids: string[] }
        Returns: {
          active_round: number
          bucket_top: string
          current_stage: string
          delay_bucket: string[]
          id: string
          ur_aging_days: number
        }[]
      }
      abd_progress_cells:
        | {
            Args: {
              _batch_no?: string
              _bucket: string
              _from?: string
              _plot?: string
              _team?: string
              _to?: string
            }
            Returns: {
              actual_cnt: number
              bucket_iso: string
              group_key: string[]
              plan_cnt: number
              stage: string
            }[]
          }
        | {
            Args: {
              _as_of_date: string
              _bucket: string
              _group_by: string[]
              _plan_mode: string
              _plots: string[]
              _range_end: string
              _range_start: string
              _round: string
              _teams: string[]
            }
            Returns: {
              actual_cnt: number
              bucket_iso: string
              group_key: string[]
              plan_cnt: number
              stage: string
            }[]
          }
      abd_progress_totals:
        | {
            Args: {
              _asof?: string
              _batch_no?: string
              _plot?: string
              _team?: string
            }
            Returns: {
              actual_upto: number
              done_upto: number
              group_key: string[]
              plan_upto: number
              stage: string
              total: number
            }[]
          }
        | {
            Args: {
              _as_of_date: string
              _group_by: string[]
              _plan_mode: string
              _plots: string[]
              _round: string
              _teams: string[]
            }
            Returns: {
              actual_upto: number
              done_upto: number
              group_key: string[]
              plan_upto: number
              stage: string
              total: number
            }[]
          }
      abd_round_stage_dates: {
        Args: {
          _round: number
          _row: Database["public"]["Tables"]["abd_items_raw"]["Row"]
          _stage: string
        }
        Returns: {
          adate: string
          pdate: string
        }[]
      }
      allocate_main_task_no: { Args: { _discipline: string }; Returns: string }
      allocate_task_no: {
        Args: { _discipline: string; _main_task_no: string }
        Returns: string
      }
      backup_disable_triggers: {
        Args: { _table_name: string }
        Returns: undefined
      }
      backup_enable_triggers: {
        Args: { _table_name: string }
        Returns: undefined
      }
      backup_insert_rows_from_json: {
        Args: { _rows_json: Json; _table_name: string }
        Returns: number
      }
      backup_truncate_table: {
        Args: { _table_name: string }
        Returns: undefined
      }
      calc_auto_judgment_value: {
        Args: {
          _actual_finish: string
          _actual_progress: number
          _actual_start: string
          _data_date: string
          _plan_days: number
          _plan_end: string
          _plan_start: string
          _slip_days: number
        }
        Returns: string
      }
      can_edit_row: {
        Args: { _row_id: string; _table_name: string; _user_id: string }
        Returns: boolean
      }
      can_rollback_import_batch: {
        Args: { _batch_id: string; _kind: string }
        Returns: boolean
      }
      can_view_row: {
        Args: { _row_id: string; _table_name: string; _user_id: string }
        Returns: boolean
      }
      claim_backup_run: { Args: { _run_id: string }; Returns: boolean }
      claim_next_queued_backup_run: {
        Args: never
        Returns: {
          id: string
          metadata: Json
        }[]
      }
      create_main_with_subs: {
        Args: { _discipline: string; _main: Json; _subs: Json }
        Returns: Json
      }
      defect_data_dates: {
        Args: never
        Returns: {
          d: string
        }[]
      }
      defect_items_counts: {
        Args: { _include_inactive?: boolean }
        Returns: {
          closed_count: number
          total_count: number
          unclosed_count: number
        }[]
      }
      defect_items_dashboard_summary: {
        Args: { _include_inactive?: boolean }
        Returns: Json
      }
      defect_items_facets:
        | {
            Args: {
              _column: string
              _include_inactive?: boolean
              _status_group?: string
            }
            Returns: {
              cnt: number
              value: string
            }[]
          }
        | {
            Args: {
              _column: string
              _filters?: Json
              _include_inactive?: boolean
              _limit?: number
              _q?: string
              _status_group?: string
            }
            Returns: {
              cnt: number
              value: string
            }[]
          }
      defect_items_search: {
        Args: {
          _filters?: Json
          _include_inactive?: boolean
          _limit?: number
          _offset?: number
          _q?: string
          _sort?: Json
          _status_group?: string
        }
        Returns: {
          rows: Json
          total_count: number
        }[]
      }
      defect_items_search_ids: {
        Args: {
          _filters?: Json
          _include_inactive?: boolean
          _limit?: number
          _q?: string
          _status_group?: string
        }
        Returns: {
          id: string
        }[]
      }
      defect_snag_dashboard_matrix: {
        Args: {
          _as_of_date?: string
          _plan_groups?: string[]
          _teams?: string[]
        }
        Returns: {
          building: string
          cnt: number
          level_name: string
          plan_group: string
          room_group: string
          status_raw: string
        }[]
      }
      defect_snag_progress_cells: {
        Args: {
          _as_of_date: string
          _bucket: string
          _group_by: string[]
          _plan_groups: string[]
          _plan_mode: string
          _range_end: string
          _range_start: string
          _room_groups: string[]
          _teams: string[]
        }
        Returns: {
          actual_cnt: number
          bucket_iso: string
          group_key: string[]
          plan_cnt: number
          stage: string
        }[]
      }
      defect_snag_progress_totals: {
        Args: {
          _as_of_date: string
          _group_by: string[]
          _plan_groups: string[]
          _plan_mode: string
          _room_groups: string[]
          _teams: string[]
        }
        Returns: {
          actual_upto: number
          done_upto: number
          group_key: string[]
          plan_upto: number
          stage: string
          total: number
        }[]
      }
      delete_abd_import_batch: { Args: { _batch_id: string }; Returns: Json }
      delete_defect_import_batch: { Args: { _batch_id: string }; Returns: Json }
      delete_spare_part_import_batch: {
        Args: { _batch_id: string }
        Returns: Json
      }
      delete_task_management_import_batch: {
        Args: { _batch_id: string }
        Returns: Json
      }
      dmr_facets: {
        Args: { _column: string; _filters?: Json }
        Returns: {
          cnt: number
          value: string
        }[]
      }
      get_backup_tables: { Args: never; Returns: string[] }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role_backup: {
        Args: { _role: string; _user_id: string }
        Returns: boolean
      }
      is_admin_or_super: { Args: { _user_id: string }; Returns: boolean }
      is_full_access: { Args: { _user_id: string }; Returns: boolean }
      is_row_owner: {
        Args: {
          _hdec_eng: string
          _hdec_pic: string
          _owner_user_id: string
          _subcon: string
          _subsub: string
          _user_id: string
        }
        Returns: boolean
      }
      preview_rollback_abd_import: {
        Args: { _batch_id: string }
        Returns: Json
      }
      preview_rollback_defect_import: {
        Args: { _batch_id: string }
        Returns: Json
      }
      preview_rollback_spare_part_import: {
        Args: { _batch_id: string }
        Returns: Json
      }
      preview_rollback_task_management_import: {
        Args: { _batch_id: string }
        Returns: Json
      }
      recalc_task_auto_judgment: {
        Args: { _discipline?: string }
        Returns: number
      }
      recalc_task_progress_charts: {
        Args: { _discipline?: string }
        Returns: number
      }
      resolve_login_email: { Args: { _login_id: string }; Returns: string }
      resolve_owner_by_name: { Args: { _name: string }; Returns: string }
      rollback_abd_import: {
        Args: { _batch_id: string; _force?: boolean }
        Returns: Json
      }
      rollback_defect_import: {
        Args: { _batch_id: string; _force?: boolean }
        Returns: Json
      }
      rollback_spare_part_import: {
        Args: { _batch_id: string; _force?: boolean }
        Returns: Json
      }
      rollback_task_management_import: {
        Args: { _batch_id: string; _force?: boolean }
        Returns: Json
      }
      rollup_task_all_mains: { Args: { _discipline: string }; Returns: number }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sm_my_workspace_counts: {
        Args: { _filter_value: string; _mode: string; _today: string }
        Returns: {
          completed_count: number
          delayed_count: number
          in_progress_count: number
          today_count: number
          total_count: number
          upcoming_count: number
        }[]
      }
      sm_my_workspace_rows: {
        Args: {
          _bucket: string
          _filter_value: string
          _limit?: number
          _mode: string
          _offset?: number
          _today: string
        }
        Returns: {
          actual_closure_date: string
          actual_progress_pct: number
          actual_rectified_date: string
          created_at: string
          created_date: string
          hdec_pic_name: string
          id: string
          location_raw: string
          main_trade: string
          planned_closure_date: string
          planned_rectified_date: string
          planned_start_date: string
          source_issue_no: string
          status_raw: string
        }[]
      }
      tm_compute_derived: {
        Args: {
          _actual_finish: string
          _actual_progress: number
          _actual_start: string
          _data_date: string
          _plan_days: number
          _plan_end: string
          _plan_start: string
        }
        Returns: Json
      }
      tm_edit_record_daily: {
        Args: { p_from: string; p_to: string }
        Returns: {
          date_key: string
          user_id: string
        }[]
      }
      tm_judge_at_date: {
        Args: { p_data_date: string; p_task_ids?: string[] }
        Returns: {
          alarm_reason: string
          auto_judgment: string
          cum_actual_pct: number
          cum_plan_pct: number
          delay_days: number
          gap_pct: number
          id: string
        }[]
      }
      tm_judge_snapshot_at_date: {
        Args: { p_data_date: string; p_task_ids?: string[] }
        Returns: {
          alarm_reason: string
          auto_judgment: string
          cum_actual_pct: number
          cum_plan_pct: number
          delay_days: number
          effective_actual_progress: number
          gap_pct: number
          id: string
        }[]
      }
      tm_today_actual: {
        Args: { _as_of: string; _ids: string[] }
        Returns: {
          id: string
          t_actual: number
        }[]
      }
      update_task_summary: {
        Args: { _discipline: string; _parent_task_no: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "superuser"
        | "user"
        | "guest"
        | "super_guest"
        | "senior_user"
        | "d_superuser"
      user_type:
        | "subcontractor"
        | "hdec"
        | "pm_pd"
        | "admin"
        | "subsub"
        | "guest"
        | "hdec_pic"
        | "hdec_eng"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "superuser",
        "user",
        "guest",
        "super_guest",
        "senior_user",
        "d_superuser",
      ],
      user_type: [
        "subcontractor",
        "hdec",
        "pm_pd",
        "admin",
        "subsub",
        "guest",
        "hdec_pic",
        "hdec_eng",
      ],
    },
  },
} as const
