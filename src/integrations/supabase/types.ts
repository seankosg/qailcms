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
      abd_audit_log: {
        Row: {
          actor_id: string | null
          created_at: string
          from_status: string | null
          id: string
          item_id: string
          note: string | null
          reason: string | null
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          item_id: string
          note?: string | null
          reason?: string | null
          to_status: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          item_id?: string
          note?: string | null
          reason?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "abd_audit_log_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "abd_items_raw"
            referencedColumns: ["id"]
          },
        ]
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
      abd_change_log_preserve_20260729: {
        Row: {
          abd_item_id: string | null
          abd_number: string | null
          changed_at: string | null
          changed_by: string | null
          field: string | null
          id: string | null
          new_value: string | null
          old_value: string | null
          source: string | null
          team: string | null
          upload_id: string | null
        }
        Insert: {
          abd_item_id?: string | null
          abd_number?: string | null
          changed_at?: string | null
          changed_by?: string | null
          field?: string | null
          id?: string | null
          new_value?: string | null
          old_value?: string | null
          source?: string | null
          team?: string | null
          upload_id?: string | null
        }
        Update: {
          abd_item_id?: string | null
          abd_number?: string | null
          changed_at?: string | null
          changed_by?: string | null
          field?: string | null
          id?: string | null
          new_value?: string | null
          old_value?: string | null
          source?: string | null
          team?: string | null
          upload_id?: string | null
        }
        Relationships: []
      }
      abd_cleanup_snapshot_20260729: {
        Row: {
          abd_number: string | null
          abd_ocs_no: string | null
          aconex_date_modified: string | null
          aconex_last_synced_at: string | null
          aconex_review_status_raw: string | null
          aconex_status_raw: string | null
          active_round: number | null
          approval_date: string | null
          batch_no: string | null
          bucket_top: string | null
          created_at: string | null
          current_stage: string | null
          data_date: string | null
          delay_bucket: string[] | null
          dis: string | null
          doc_ax: string | null
          doc_axx: string | null
          doc_n: string | null
          doc_nn1: string | null
          doc_nn2: string | null
          document_title: string | null
          extra_rounds: Json | null
          field_mismatch: boolean | null
          has_r4_plus: boolean | null
          hdec_eng_name: string | null
          hdec_pic_name: string | null
          id: string | null
          inactive_reason: string | null
          is_active: boolean | null
          is_terminated: boolean | null
          latest_rev: string | null
          latest_status: string | null
          latest_status_norm: string | null
          mismatch_fields: Json | null
          needs_planning: boolean | null
          needs_revise: boolean | null
          owner_user_id: string | null
          plot: string | null
          r1_dar_actual: string | null
          r1_dar_plan: string | null
          r1_draft_finish_actual: string | null
          r1_draft_finish_plan: string | null
          r1_draft_start_actual: string | null
          r1_draft_start_plan: string | null
          r1_response_result: string | null
          r1_response_source: string | null
          r1_submission_actual: string | null
          r1_submission_plan: string | null
          r2_dar_actual: string | null
          r2_dar_plan: string | null
          r2_draft_finish_actual: string | null
          r2_draft_finish_plan: string | null
          r2_draft_start_actual: string | null
          r2_draft_start_plan: string | null
          r2_response_result: string | null
          r2_response_source: string | null
          r2_submission_actual: string | null
          r2_submission_plan: string | null
          r3_dar_actual: string | null
          r3_dar_plan: string | null
          r3_draft_finish_actual: string | null
          r3_draft_finish_plan: string | null
          r3_draft_start_actual: string | null
          r3_draft_start_plan: string | null
          r3_response_result: string | null
          r3_response_source: string | null
          r3_submission_actual: string | null
          r3_submission_plan: string | null
          raw_payload: Json | null
          revise_source_round: number | null
          row_version: number | null
          rs_result_missing: boolean | null
          service: string | null
          sl_no: number | null
          snapshot_taken_at: string
          source_import_log_id: string | null
          status_group: string | null
          status_mismatch: boolean | null
          team: string | null
          updated_at: string | null
          updated_by: string | null
          ur_aging_days: number | null
        }
        Insert: {
          abd_number?: string | null
          abd_ocs_no?: string | null
          aconex_date_modified?: string | null
          aconex_last_synced_at?: string | null
          aconex_review_status_raw?: string | null
          aconex_status_raw?: string | null
          active_round?: number | null
          approval_date?: string | null
          batch_no?: string | null
          bucket_top?: string | null
          created_at?: string | null
          current_stage?: string | null
          data_date?: string | null
          delay_bucket?: string[] | null
          dis?: string | null
          doc_ax?: string | null
          doc_axx?: string | null
          doc_n?: string | null
          doc_nn1?: string | null
          doc_nn2?: string | null
          document_title?: string | null
          extra_rounds?: Json | null
          field_mismatch?: boolean | null
          has_r4_plus?: boolean | null
          hdec_eng_name?: string | null
          hdec_pic_name?: string | null
          id?: string | null
          inactive_reason?: string | null
          is_active?: boolean | null
          is_terminated?: boolean | null
          latest_rev?: string | null
          latest_status?: string | null
          latest_status_norm?: string | null
          mismatch_fields?: Json | null
          needs_planning?: boolean | null
          needs_revise?: boolean | null
          owner_user_id?: string | null
          plot?: string | null
          r1_dar_actual?: string | null
          r1_dar_plan?: string | null
          r1_draft_finish_actual?: string | null
          r1_draft_finish_plan?: string | null
          r1_draft_start_actual?: string | null
          r1_draft_start_plan?: string | null
          r1_response_result?: string | null
          r1_response_source?: string | null
          r1_submission_actual?: string | null
          r1_submission_plan?: string | null
          r2_dar_actual?: string | null
          r2_dar_plan?: string | null
          r2_draft_finish_actual?: string | null
          r2_draft_finish_plan?: string | null
          r2_draft_start_actual?: string | null
          r2_draft_start_plan?: string | null
          r2_response_result?: string | null
          r2_response_source?: string | null
          r2_submission_actual?: string | null
          r2_submission_plan?: string | null
          r3_dar_actual?: string | null
          r3_dar_plan?: string | null
          r3_draft_finish_actual?: string | null
          r3_draft_finish_plan?: string | null
          r3_draft_start_actual?: string | null
          r3_draft_start_plan?: string | null
          r3_response_result?: string | null
          r3_response_source?: string | null
          r3_submission_actual?: string | null
          r3_submission_plan?: string | null
          raw_payload?: Json | null
          revise_source_round?: number | null
          row_version?: number | null
          rs_result_missing?: boolean | null
          service?: string | null
          sl_no?: number | null
          snapshot_taken_at?: string
          source_import_log_id?: string | null
          status_group?: string | null
          status_mismatch?: boolean | null
          team?: string | null
          updated_at?: string | null
          updated_by?: string | null
          ur_aging_days?: number | null
        }
        Update: {
          abd_number?: string | null
          abd_ocs_no?: string | null
          aconex_date_modified?: string | null
          aconex_last_synced_at?: string | null
          aconex_review_status_raw?: string | null
          aconex_status_raw?: string | null
          active_round?: number | null
          approval_date?: string | null
          batch_no?: string | null
          bucket_top?: string | null
          created_at?: string | null
          current_stage?: string | null
          data_date?: string | null
          delay_bucket?: string[] | null
          dis?: string | null
          doc_ax?: string | null
          doc_axx?: string | null
          doc_n?: string | null
          doc_nn1?: string | null
          doc_nn2?: string | null
          document_title?: string | null
          extra_rounds?: Json | null
          field_mismatch?: boolean | null
          has_r4_plus?: boolean | null
          hdec_eng_name?: string | null
          hdec_pic_name?: string | null
          id?: string | null
          inactive_reason?: string | null
          is_active?: boolean | null
          is_terminated?: boolean | null
          latest_rev?: string | null
          latest_status?: string | null
          latest_status_norm?: string | null
          mismatch_fields?: Json | null
          needs_planning?: boolean | null
          needs_revise?: boolean | null
          owner_user_id?: string | null
          plot?: string | null
          r1_dar_actual?: string | null
          r1_dar_plan?: string | null
          r1_draft_finish_actual?: string | null
          r1_draft_finish_plan?: string | null
          r1_draft_start_actual?: string | null
          r1_draft_start_plan?: string | null
          r1_response_result?: string | null
          r1_response_source?: string | null
          r1_submission_actual?: string | null
          r1_submission_plan?: string | null
          r2_dar_actual?: string | null
          r2_dar_plan?: string | null
          r2_draft_finish_actual?: string | null
          r2_draft_finish_plan?: string | null
          r2_draft_start_actual?: string | null
          r2_draft_start_plan?: string | null
          r2_response_result?: string | null
          r2_response_source?: string | null
          r2_submission_actual?: string | null
          r2_submission_plan?: string | null
          r3_dar_actual?: string | null
          r3_dar_plan?: string | null
          r3_draft_finish_actual?: string | null
          r3_draft_finish_plan?: string | null
          r3_draft_start_actual?: string | null
          r3_draft_start_plan?: string | null
          r3_response_result?: string | null
          r3_response_source?: string | null
          r3_submission_actual?: string | null
          r3_submission_plan?: string | null
          raw_payload?: Json | null
          revise_source_round?: number | null
          row_version?: number | null
          rs_result_missing?: boolean | null
          service?: string | null
          sl_no?: number | null
          snapshot_taken_at?: string
          source_import_log_id?: string | null
          status_group?: string | null
          status_mismatch?: boolean | null
          team?: string | null
          updated_at?: string | null
          updated_by?: string | null
          ur_aging_days?: number | null
        }
        Relationships: []
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
          applied_rows: number | null
          build_id: string | null
          created_at: string
          data_date: string | null
          errors: Json | null
          exclusions: Json | null
          file_name: string
          finished_at: string | null
          id: string
          imported_by: string | null
          inactivated: number | null
          inserted: number | null
          mismatched: number | null
          note: string | null
          parsed_rows: number | null
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
          applied_rows?: number | null
          build_id?: string | null
          created_at?: string
          data_date?: string | null
          errors?: Json | null
          exclusions?: Json | null
          file_name: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          inactivated?: number | null
          inserted?: number | null
          mismatched?: number | null
          note?: string | null
          parsed_rows?: number | null
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
          applied_rows?: number | null
          build_id?: string | null
          created_at?: string
          data_date?: string | null
          errors?: Json | null
          exclusions?: Json | null
          file_name?: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          inactivated?: number | null
          inserted?: number | null
          mismatched?: number | null
          note?: string | null
          parsed_rows?: number | null
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
          audit_at: string | null
          audit_by: string | null
          audit_note: string | null
          audit_reason: string | null
          audit_selected_at: string | null
          audit_status: string
          batch_no: string | null
          bucket_top: string | null
          completed_stage: string | null
          completed_stage_group: string | null
          created_at: string
          current_stage: string | null
          data_date: string | null
          delay_bucket: string[]
          delay_late: string[]
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
          is_reopened: boolean
          is_terminated: boolean
          latest_rev: string | null
          latest_status: string | null
          latest_status_norm: string | null
          mf_changed_after_ds: boolean
          mf_check: boolean
          mf_checked_at: string | null
          mf_checked_by: string | null
          mf_reference: string | null
          mf_revision: string | null
          mf_types: string[]
          mismatch_fields: Json
          needs_planning: boolean
          needs_revise: boolean
          ocs_check: string
          ocs_complied: number
          ocs_total: number
          owner_user_id: string | null
          plot: string | null
          primary_delay: string | null
          r1_dar_actual: string | null
          r1_dar_plan: string | null
          r1_draft_finish_actual: string | null
          r1_draft_finish_plan: string | null
          r1_draft_start_actual: string | null
          r1_draft_start_plan: string | null
          r1_response_result: string | null
          r1_response_source: string | null
          r1_submission_actual: string | null
          r1_submission_plan: string | null
          r2_dar_actual: string | null
          r2_dar_plan: string | null
          r2_draft_finish_actual: string | null
          r2_draft_finish_plan: string | null
          r2_draft_start_actual: string | null
          r2_draft_start_plan: string | null
          r2_response_result: string | null
          r2_response_source: string | null
          r2_submission_actual: string | null
          r2_submission_plan: string | null
          r3_dar_actual: string | null
          r3_dar_plan: string | null
          r3_draft_finish_actual: string | null
          r3_draft_finish_plan: string | null
          r3_draft_start_actual: string | null
          r3_draft_start_plan: string | null
          r3_response_result: string | null
          r3_response_source: string | null
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
          audit_at?: string | null
          audit_by?: string | null
          audit_note?: string | null
          audit_reason?: string | null
          audit_selected_at?: string | null
          audit_status?: string
          batch_no?: string | null
          bucket_top?: string | null
          completed_stage?: string | null
          completed_stage_group?: string | null
          created_at?: string
          current_stage?: string | null
          data_date?: string | null
          delay_bucket?: string[]
          delay_late?: string[]
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
          is_reopened?: boolean
          is_terminated?: boolean
          latest_rev?: string | null
          latest_status?: string | null
          latest_status_norm?: string | null
          mf_changed_after_ds?: boolean
          mf_check?: boolean
          mf_checked_at?: string | null
          mf_checked_by?: string | null
          mf_reference?: string | null
          mf_revision?: string | null
          mf_types?: string[]
          mismatch_fields?: Json
          needs_planning?: boolean
          needs_revise?: boolean
          ocs_check?: string
          ocs_complied?: number
          ocs_total?: number
          owner_user_id?: string | null
          plot?: string | null
          primary_delay?: string | null
          r1_dar_actual?: string | null
          r1_dar_plan?: string | null
          r1_draft_finish_actual?: string | null
          r1_draft_finish_plan?: string | null
          r1_draft_start_actual?: string | null
          r1_draft_start_plan?: string | null
          r1_response_result?: string | null
          r1_response_source?: string | null
          r1_submission_actual?: string | null
          r1_submission_plan?: string | null
          r2_dar_actual?: string | null
          r2_dar_plan?: string | null
          r2_draft_finish_actual?: string | null
          r2_draft_finish_plan?: string | null
          r2_draft_start_actual?: string | null
          r2_draft_start_plan?: string | null
          r2_response_result?: string | null
          r2_response_source?: string | null
          r2_submission_actual?: string | null
          r2_submission_plan?: string | null
          r3_dar_actual?: string | null
          r3_dar_plan?: string | null
          r3_draft_finish_actual?: string | null
          r3_draft_finish_plan?: string | null
          r3_draft_start_actual?: string | null
          r3_draft_start_plan?: string | null
          r3_response_result?: string | null
          r3_response_source?: string | null
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
          audit_at?: string | null
          audit_by?: string | null
          audit_note?: string | null
          audit_reason?: string | null
          audit_selected_at?: string | null
          audit_status?: string
          batch_no?: string | null
          bucket_top?: string | null
          completed_stage?: string | null
          completed_stage_group?: string | null
          created_at?: string
          current_stage?: string | null
          data_date?: string | null
          delay_bucket?: string[]
          delay_late?: string[]
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
          is_reopened?: boolean
          is_terminated?: boolean
          latest_rev?: string | null
          latest_status?: string | null
          latest_status_norm?: string | null
          mf_changed_after_ds?: boolean
          mf_check?: boolean
          mf_checked_at?: string | null
          mf_checked_by?: string | null
          mf_reference?: string | null
          mf_revision?: string | null
          mf_types?: string[]
          mismatch_fields?: Json
          needs_planning?: boolean
          needs_revise?: boolean
          ocs_check?: string
          ocs_complied?: number
          ocs_total?: number
          owner_user_id?: string | null
          plot?: string | null
          primary_delay?: string | null
          r1_dar_actual?: string | null
          r1_dar_plan?: string | null
          r1_draft_finish_actual?: string | null
          r1_draft_finish_plan?: string | null
          r1_draft_start_actual?: string | null
          r1_draft_start_plan?: string | null
          r1_response_result?: string | null
          r1_response_source?: string | null
          r1_submission_actual?: string | null
          r1_submission_plan?: string | null
          r2_dar_actual?: string | null
          r2_dar_plan?: string | null
          r2_draft_finish_actual?: string | null
          r2_draft_finish_plan?: string | null
          r2_draft_start_actual?: string | null
          r2_draft_start_plan?: string | null
          r2_response_result?: string | null
          r2_response_source?: string | null
          r2_submission_actual?: string | null
          r2_submission_plan?: string | null
          r3_dar_actual?: string | null
          r3_dar_plan?: string | null
          r3_draft_finish_actual?: string | null
          r3_draft_finish_plan?: string | null
          r3_draft_start_actual?: string | null
          r3_draft_start_plan?: string | null
          r3_response_result?: string | null
          r3_response_source?: string | null
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
      abd_judge_v_active_snapshot_20260729: {
        Row: {
          ar_before: number | null
          bt_before: string | null
          cs_before: string | null
          id: string | null
          latest_status: string | null
        }
        Insert: {
          ar_before?: number | null
          bt_before?: string | null
          cs_before?: string | null
          id?: string | null
          latest_status?: string | null
        }
        Update: {
          ar_before?: number | null
          bt_before?: string | null
          cs_before?: string | null
          id?: string | null
          latest_status?: string | null
        }
        Relationships: []
      }
      abd_latest_status_restore_snapshot_20260727: {
        Row: {
          abd_item_id: string
          abd_number: string | null
          id: string
          note: string | null
          prev_latest_status: string | null
          restored: boolean
          restored_to: string | null
          snapshot_at: string
        }
        Insert: {
          abd_item_id: string
          abd_number?: string | null
          id?: string
          note?: string | null
          prev_latest_status?: string | null
          restored?: boolean
          restored_to?: string | null
          snapshot_at?: string
        }
        Update: {
          abd_item_id?: string
          abd_number?: string | null
          id?: string
          note?: string | null
          prev_latest_status?: string | null
          restored?: boolean
          restored_to?: string | null
          snapshot_at?: string
        }
        Relationships: []
      }
      abd_latest_status_restore_snapshot_v2_20260727: {
        Row: {
          abd_number: string | null
          id: string | null
          is_terminated: boolean | null
          latest_status: string | null
          snapshot_at: string | null
          updated_at: string | null
        }
        Insert: {
          abd_number?: string | null
          id?: string | null
          is_terminated?: boolean | null
          latest_status?: string | null
          snapshot_at?: string | null
          updated_at?: string | null
        }
        Update: {
          abd_number?: string | null
          id?: string | null
          is_terminated?: boolean | null
          latest_status?: string | null
          snapshot_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      abd_mf_change_log: {
        Row: {
          after_ds: boolean
          after_value: Json | null
          before_value: Json | null
          changed_by: string | null
          created_at: string
          id: string
          impact_note: string | null
          item_id: string
          reason: string | null
        }
        Insert: {
          after_ds?: boolean
          after_value?: Json | null
          before_value?: Json | null
          changed_by?: string | null
          created_at?: string
          id?: string
          impact_note?: string | null
          item_id: string
          reason?: string | null
        }
        Update: {
          after_ds?: boolean
          after_value?: Json | null
          before_value?: Json | null
          changed_by?: string | null
          created_at?: string
          id?: string
          impact_note?: string | null
          item_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "abd_mf_change_log_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "abd_items_raw"
            referencedColumns: ["id"]
          },
        ]
      }
      abd_ocs_attachment_comment_links: {
        Row: {
          attachment_id: string
          comment_id: string
          created_at: string
          id: string
          import_log_id: string | null
          mapping_method: string | null
          mapping_status: string
          sort_order: number | null
          source_attachment_id: string | null
          source_comment_id: string | null
          updated_at: string
        }
        Insert: {
          attachment_id: string
          comment_id: string
          created_at?: string
          id?: string
          import_log_id?: string | null
          mapping_method?: string | null
          mapping_status?: string
          sort_order?: number | null
          source_attachment_id?: string | null
          source_comment_id?: string | null
          updated_at?: string
        }
        Update: {
          attachment_id?: string
          comment_id?: string
          created_at?: string
          id?: string
          import_log_id?: string | null
          mapping_method?: string | null
          mapping_status?: string
          sort_order?: number | null
          source_attachment_id?: string | null
          source_comment_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "abd_ocs_attachment_comment_links_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "abd_ocs_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abd_ocs_attachment_comment_links_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "abd_ocs_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      abd_ocs_attachments: {
        Row: {
          byte_size: number | null
          comment_id: string | null
          content_hash: string | null
          created_at: string
          height: number | null
          id: string
          image_format: string | null
          link_status: string
          mime_type: string | null
          sort_order: number
          source_attachment_id: string
          source_comment_id: string | null
          source_image_index: number | null
          storage_path: string
          width: number | null
        }
        Insert: {
          byte_size?: number | null
          comment_id?: string | null
          content_hash?: string | null
          created_at?: string
          height?: number | null
          id?: string
          image_format?: string | null
          link_status?: string
          mime_type?: string | null
          sort_order?: number
          source_attachment_id: string
          source_comment_id?: string | null
          source_image_index?: number | null
          storage_path: string
          width?: number | null
        }
        Update: {
          byte_size?: number | null
          comment_id?: string | null
          content_hash?: string | null
          created_at?: string
          height?: number | null
          id?: string
          image_format?: string | null
          link_status?: string
          mime_type?: string | null
          sort_order?: number
          source_attachment_id?: string
          source_comment_id?: string | null
          source_image_index?: number | null
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "abd_ocs_attachments_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "abd_ocs_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      abd_ocs_comment_abd_links: {
        Row: {
          abd_item_id: string
          abd_number: string
          comment_id: string
          created_at: string
          id: string
          import_log_id: string | null
          is_primary: boolean
          link_method: string
          source_comment_id: string
          updated_at: string
        }
        Insert: {
          abd_item_id: string
          abd_number: string
          comment_id: string
          created_at?: string
          id?: string
          import_log_id?: string | null
          is_primary?: boolean
          link_method?: string
          source_comment_id: string
          updated_at?: string
        }
        Update: {
          abd_item_id?: string
          abd_number?: string
          comment_id?: string
          created_at?: string
          id?: string
          import_log_id?: string | null
          is_primary?: boolean
          link_method?: string
          source_comment_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "abd_ocs_comment_abd_links_abd_item_id_fkey"
            columns: ["abd_item_id"]
            isOneToOne: false
            referencedRelation: "abd_items_raw"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abd_ocs_comment_abd_links_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "abd_ocs_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      abd_ocs_comment_groups: {
        Row: {
          atomic_item_count: number
          contractor_response_raw: string | null
          created_at: string
          drawing_number_norm: string | null
          group_key: string
          id: string
          import_log_id: string | null
          ocs_number: string | null
          ocs_number_norm: string | null
          response_mapping_status: string
          source_drawing_number: string | null
          source_file_name: string | null
          source_parent_comment_id: string
          source_row_index: number | null
          source_sheet_name: string | null
          updated_at: string
        }
        Insert: {
          atomic_item_count?: number
          contractor_response_raw?: string | null
          created_at?: string
          drawing_number_norm?: string | null
          group_key: string
          id?: string
          import_log_id?: string | null
          ocs_number?: string | null
          ocs_number_norm?: string | null
          response_mapping_status?: string
          source_drawing_number?: string | null
          source_file_name?: string | null
          source_parent_comment_id: string
          source_row_index?: number | null
          source_sheet_name?: string | null
          updated_at?: string
        }
        Update: {
          atomic_item_count?: number
          contractor_response_raw?: string | null
          created_at?: string
          drawing_number_norm?: string | null
          group_key?: string
          id?: string
          import_log_id?: string | null
          ocs_number?: string | null
          ocs_number_norm?: string | null
          response_mapping_status?: string
          source_drawing_number?: string | null
          source_file_name?: string | null
          source_parent_comment_id?: string
          source_row_index?: number | null
          source_sheet_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      abd_ocs_comments: {
        Row: {
          abd_item_id: string | null
          assessed_code: string | null
          atomic_item_count: number | null
          atomic_item_no: number | null
          comment_group_id: string | null
          comment_part: string | null
          comment_revision: string | null
          contractor_response: string | null
          created_at: string
          discipline: string | null
          drawing_number_norm: string | null
          file_revision: string | null
          id: string
          import_log_id: string | null
          imported_at: string
          inactive_at: string | null
          is_active: boolean
          is_superseded_by_v2: boolean
          link_method: string | null
          link_note: string | null
          link_status: string
          linked_at: string | null
          ocs_comment: string | null
          ocs_number: string | null
          ocs_number_norm: string | null
          ocs_sn: string | null
          plot: string | null
          project: string | null
          response_mapping_status: string | null
          retired_reason: string | null
          review_priority: string | null
          service: string | null
          sign_off_status: string | null
          source_comment_id: string
          source_drawing_number: string | null
          source_extra: Json | null
          source_file_hash: string | null
          source_file_name: string | null
          source_imported_at: string | null
          source_modified_at: string | null
          source_parent_comment_id: string | null
          source_row_hash: string | null
          source_row_index: number | null
          source_sheet_name: string | null
          split_status: string | null
          superseded_at: string | null
          team: string | null
          updated_at: string
          v2_import_log_id: string | null
          validation_note: string | null
          warning_codes: string[]
        }
        Insert: {
          abd_item_id?: string | null
          assessed_code?: string | null
          atomic_item_count?: number | null
          atomic_item_no?: number | null
          comment_group_id?: string | null
          comment_part?: string | null
          comment_revision?: string | null
          contractor_response?: string | null
          created_at?: string
          discipline?: string | null
          drawing_number_norm?: string | null
          file_revision?: string | null
          id?: string
          import_log_id?: string | null
          imported_at?: string
          inactive_at?: string | null
          is_active?: boolean
          is_superseded_by_v2?: boolean
          link_method?: string | null
          link_note?: string | null
          link_status?: string
          linked_at?: string | null
          ocs_comment?: string | null
          ocs_number?: string | null
          ocs_number_norm?: string | null
          ocs_sn?: string | null
          plot?: string | null
          project?: string | null
          response_mapping_status?: string | null
          retired_reason?: string | null
          review_priority?: string | null
          service?: string | null
          sign_off_status?: string | null
          source_comment_id: string
          source_drawing_number?: string | null
          source_extra?: Json | null
          source_file_hash?: string | null
          source_file_name?: string | null
          source_imported_at?: string | null
          source_modified_at?: string | null
          source_parent_comment_id?: string | null
          source_row_hash?: string | null
          source_row_index?: number | null
          source_sheet_name?: string | null
          split_status?: string | null
          superseded_at?: string | null
          team?: string | null
          updated_at?: string
          v2_import_log_id?: string | null
          validation_note?: string | null
          warning_codes?: string[]
        }
        Update: {
          abd_item_id?: string | null
          assessed_code?: string | null
          atomic_item_count?: number | null
          atomic_item_no?: number | null
          comment_group_id?: string | null
          comment_part?: string | null
          comment_revision?: string | null
          contractor_response?: string | null
          created_at?: string
          discipline?: string | null
          drawing_number_norm?: string | null
          file_revision?: string | null
          id?: string
          import_log_id?: string | null
          imported_at?: string
          inactive_at?: string | null
          is_active?: boolean
          is_superseded_by_v2?: boolean
          link_method?: string | null
          link_note?: string | null
          link_status?: string
          linked_at?: string | null
          ocs_comment?: string | null
          ocs_number?: string | null
          ocs_number_norm?: string | null
          ocs_sn?: string | null
          plot?: string | null
          project?: string | null
          response_mapping_status?: string | null
          retired_reason?: string | null
          review_priority?: string | null
          service?: string | null
          sign_off_status?: string | null
          source_comment_id?: string
          source_drawing_number?: string | null
          source_extra?: Json | null
          source_file_hash?: string | null
          source_file_name?: string | null
          source_imported_at?: string | null
          source_modified_at?: string | null
          source_parent_comment_id?: string | null
          source_row_hash?: string | null
          source_row_index?: number | null
          source_sheet_name?: string | null
          split_status?: string | null
          superseded_at?: string | null
          team?: string | null
          updated_at?: string
          v2_import_log_id?: string | null
          validation_note?: string | null
          warning_codes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "abd_ocs_comments_abd_item_id_fkey"
            columns: ["abd_item_id"]
            isOneToOne: false
            referencedRelation: "abd_items_raw"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abd_ocs_comments_comment_group_id_fkey"
            columns: ["comment_group_id"]
            isOneToOne: false
            referencedRelation: "abd_ocs_comment_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abd_ocs_comments_import_log_fk"
            columns: ["import_log_id"]
            isOneToOne: false
            referencedRelation: "abd_ocs_import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      abd_ocs_compliance: {
        Row: {
          comment_id: string
          complied: boolean
          complied_at: string | null
          complied_by: string | null
          complied_by_name: string | null
          created_at: string
          source: string
          updated_at: string
          updated_by: string | null
          updated_by_name: string | null
        }
        Insert: {
          comment_id: string
          complied?: boolean
          complied_at?: string | null
          complied_by?: string | null
          complied_by_name?: string | null
          created_at?: string
          source?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Update: {
          comment_id?: string
          complied?: boolean
          complied_at?: string | null
          complied_by?: string | null
          complied_by_name?: string | null
          created_at?: string
          source?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "abd_ocs_compliance_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: true
            referencedRelation: "abd_ocs_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      abd_ocs_compliance_log: {
        Row: {
          abd_item_id: string | null
          abd_number: string | null
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          comment_id: string | null
          id: string
          new_complied: boolean
          ocs_number: string | null
          old_complied: boolean | null
          source: string
          source_comment_id: string
        }
        Insert: {
          abd_item_id?: string | null
          abd_number?: string | null
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          comment_id?: string | null
          id?: string
          new_complied: boolean
          ocs_number?: string | null
          old_complied?: boolean | null
          source: string
          source_comment_id: string
        }
        Update: {
          abd_item_id?: string | null
          abd_number?: string | null
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          comment_id?: string | null
          id?: string
          new_complied?: boolean
          ocs_number?: string | null
          old_complied?: boolean | null
          source?: string
          source_comment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "abd_ocs_compliance_log_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "abd_ocs_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      abd_ocs_import_logs: {
        Row: {
          attachment_linked: number
          attachment_missing_storage: number
          attachment_needs_review: number
          attachment_orphan_storage: number
          attachment_registered: number
          attachment_total: number
          compliance_inserted_count: number
          data_file_hash: string | null
          data_file_name: string | null
          dryrun: Json | null
          error_count: number
          errors: Json | null
          finished_at: string | null
          id: string
          imported_by: string | null
          inactivated_count: number
          inserted_count: number
          linked_count: number
          manifest_hash: string | null
          manifest_name: string | null
          manual_review_count: number
          mismatch_warning_count: number
          result: Json | null
          snapshot_id: string | null
          source_file_hash: string | null
          source_file_name: string | null
          started_at: string
          status: string
          storage_data_path: string | null
          storage_manifest_path: string | null
          total_count: number
          unchanged_count: number
          unmatched_count: number
          updated_count: number
          warnings: Json | null
        }
        Insert: {
          attachment_linked?: number
          attachment_missing_storage?: number
          attachment_needs_review?: number
          attachment_orphan_storage?: number
          attachment_registered?: number
          attachment_total?: number
          compliance_inserted_count?: number
          data_file_hash?: string | null
          data_file_name?: string | null
          dryrun?: Json | null
          error_count?: number
          errors?: Json | null
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          inactivated_count?: number
          inserted_count?: number
          linked_count?: number
          manifest_hash?: string | null
          manifest_name?: string | null
          manual_review_count?: number
          mismatch_warning_count?: number
          result?: Json | null
          snapshot_id?: string | null
          source_file_hash?: string | null
          source_file_name?: string | null
          started_at?: string
          status?: string
          storage_data_path?: string | null
          storage_manifest_path?: string | null
          total_count?: number
          unchanged_count?: number
          unmatched_count?: number
          updated_count?: number
          warnings?: Json | null
        }
        Update: {
          attachment_linked?: number
          attachment_missing_storage?: number
          attachment_needs_review?: number
          attachment_orphan_storage?: number
          attachment_registered?: number
          attachment_total?: number
          compliance_inserted_count?: number
          data_file_hash?: string | null
          data_file_name?: string | null
          dryrun?: Json | null
          error_count?: number
          errors?: Json | null
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          inactivated_count?: number
          inserted_count?: number
          linked_count?: number
          manifest_hash?: string | null
          manifest_name?: string | null
          manual_review_count?: number
          mismatch_warning_count?: number
          result?: Json | null
          snapshot_id?: string | null
          source_file_hash?: string | null
          source_file_name?: string | null
          started_at?: string
          status?: string
          storage_data_path?: string | null
          storage_manifest_path?: string | null
          total_count?: number
          unchanged_count?: number
          unmatched_count?: number
          updated_count?: number
          warnings?: Json | null
        }
        Relationships: []
      }
      abd_ocs_inc_verify_receipts: {
        Row: {
          actual_byte_size: number | null
          actual_sha256: string | null
          bucket: string
          error: string | null
          expected_byte_size: number | null
          expected_sha256: string
          id: string
          ok: boolean
          package_id: string
          path: string
          run_id: string
          verified_at: string
          verified_by: string | null
        }
        Insert: {
          actual_byte_size?: number | null
          actual_sha256?: string | null
          bucket: string
          error?: string | null
          expected_byte_size?: number | null
          expected_sha256: string
          id?: string
          ok?: boolean
          package_id: string
          path: string
          run_id: string
          verified_at?: string
          verified_by?: string | null
        }
        Update: {
          actual_byte_size?: number | null
          actual_sha256?: string | null
          bucket?: string
          error?: string | null
          expected_byte_size?: number | null
          expected_sha256?: string
          id?: string
          ok?: boolean
          package_id?: string
          path?: string
          run_id?: string
          verified_at?: string
          verified_by?: string | null
        }
        Relationships: []
      }
      abd_ocs_number_correction_log: {
        Row: {
          abd_number: string
          change_category: string | null
          created_at: string
          executed_at: string
          executed_by: string | null
          id: string
          migration_name: string
          ocs_after: string | null
          ocs_before: string | null
          snapshot_id: string | null
          updated: boolean
          verification: Json | null
        }
        Insert: {
          abd_number: string
          change_category?: string | null
          created_at?: string
          executed_at?: string
          executed_by?: string | null
          id?: string
          migration_name: string
          ocs_after?: string | null
          ocs_before?: string | null
          snapshot_id?: string | null
          updated?: boolean
          verification?: Json | null
        }
        Update: {
          abd_number?: string
          change_category?: string | null
          created_at?: string
          executed_at?: string
          executed_by?: string | null
          id?: string
          migration_name?: string
          ocs_after?: string | null
          ocs_before?: string | null
          snapshot_id?: string | null
          updated?: boolean
          verification?: Json | null
        }
        Relationships: []
      }
      abd_ocs_response_comment_links: {
        Row: {
          atomic_comment_id: string | null
          confidence_score: number | null
          created_at: string
          evidence_terms: Json | null
          id: string
          import_log_id: string | null
          is_active: boolean
          mapping_method: string | null
          mapping_status: string
          response_segment_id: string
          source_atomic_comment_id: string | null
          updated_at: string
        }
        Insert: {
          atomic_comment_id?: string | null
          confidence_score?: number | null
          created_at?: string
          evidence_terms?: Json | null
          id?: string
          import_log_id?: string | null
          is_active?: boolean
          mapping_method?: string | null
          mapping_status: string
          response_segment_id: string
          source_atomic_comment_id?: string | null
          updated_at?: string
        }
        Update: {
          atomic_comment_id?: string | null
          confidence_score?: number | null
          created_at?: string
          evidence_terms?: Json | null
          id?: string
          import_log_id?: string | null
          is_active?: boolean
          mapping_method?: string | null
          mapping_status?: string
          response_segment_id?: string
          source_atomic_comment_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "abd_ocs_response_comment_links_atomic_comment_id_fkey"
            columns: ["atomic_comment_id"]
            isOneToOne: false
            referencedRelation: "abd_ocs_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abd_ocs_response_comment_links_response_segment_id_fkey"
            columns: ["response_segment_id"]
            isOneToOne: false
            referencedRelation: "abd_ocs_response_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      abd_ocs_response_segments: {
        Row: {
          comment_group_id: string | null
          created_at: string
          id: string
          import_log_id: string | null
          is_active: boolean
          response_segment_no: number
          response_source_label: string | null
          response_text: string | null
          source_file_name: string | null
          source_hash: string
          source_parent_comment_id: string
          source_row: number | null
          source_sheet: string | null
          updated_at: string
        }
        Insert: {
          comment_group_id?: string | null
          created_at?: string
          id?: string
          import_log_id?: string | null
          is_active?: boolean
          response_segment_no?: number
          response_source_label?: string | null
          response_text?: string | null
          source_file_name?: string | null
          source_hash?: string
          source_parent_comment_id: string
          source_row?: number | null
          source_sheet?: string | null
          updated_at?: string
        }
        Update: {
          comment_group_id?: string | null
          created_at?: string
          id?: string
          import_log_id?: string | null
          is_active?: boolean
          response_segment_no?: number
          response_source_label?: string | null
          response_text?: string | null
          source_file_name?: string | null
          source_hash?: string
          source_parent_comment_id?: string
          source_row?: number | null
          source_sheet?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "abd_ocs_response_segments_comment_group_id_fkey"
            columns: ["comment_group_id"]
            isOneToOne: false
            referencedRelation: "abd_ocs_comment_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      abd_ocs_source_files: {
        Row: {
          byte_size: number
          content_hash: string
          created_at: string
          file_name: string
          id: string
          is_active: boolean
          mime_type: string
          relative_path: string
          source_file_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          byte_size: number
          content_hash: string
          created_at?: string
          file_name: string
          id?: string
          is_active?: boolean
          mime_type: string
          relative_path: string
          source_file_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          byte_size?: number
          content_hash?: string
          created_at?: string
          file_name?: string
          id?: string
          is_active?: boolean
          mime_type?: string
          relative_path?: string
          source_file_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      abd_ocs_v3_stage_attachments: {
        Row: {
          atomic_comment_id: string | null
          attachment_id: string
          attachment_scope: string | null
          byte_size: number | null
          comment_group_id: string | null
          comment_id: string | null
          content_hash: string | null
          created_at: string
          height: number | null
          image_format: string | null
          mime_type: string | null
          source_image_index: number | null
          source_parent_comment_id: string | null
          stage_run_id: string
          storage_path: string | null
          width: number | null
        }
        Insert: {
          atomic_comment_id?: string | null
          attachment_id: string
          attachment_scope?: string | null
          byte_size?: number | null
          comment_group_id?: string | null
          comment_id?: string | null
          content_hash?: string | null
          created_at?: string
          height?: number | null
          image_format?: string | null
          mime_type?: string | null
          source_image_index?: number | null
          source_parent_comment_id?: string | null
          stage_run_id: string
          storage_path?: string | null
          width?: number | null
        }
        Update: {
          atomic_comment_id?: string | null
          attachment_id?: string
          attachment_scope?: string | null
          byte_size?: number | null
          comment_group_id?: string | null
          comment_id?: string | null
          content_hash?: string | null
          created_at?: string
          height?: number | null
          image_format?: string | null
          mime_type?: string | null
          source_image_index?: number | null
          source_parent_comment_id?: string | null
          stage_run_id?: string
          storage_path?: string | null
          width?: number | null
        }
        Relationships: []
      }
      abd_ocs_v3_stage_comments: {
        Row: {
          abd_numbers: string[]
          assessed_code: string | null
          atomic_item_count: number | null
          atomic_item_no: number | null
          comment_group_id: string | null
          comment_part: number | null
          compliance_reason: string | null
          compliance_source: string | null
          contractor_response: string | null
          created_at: string
          drawing_number: string | null
          initial_complied: boolean
          is_active: boolean
          link_method: string | null
          link_scope: string | null
          link_status: string | null
          ocs_comment: string | null
          ocs_number: string | null
          retired_reason: string | null
          source_comment_id: string
          source_file_name: string | null
          source_parent_comment_id: string
          source_row_index: number | null
          source_sheet_name: string | null
          split_status: string | null
          stage_run_id: string
        }
        Insert: {
          abd_numbers?: string[]
          assessed_code?: string | null
          atomic_item_count?: number | null
          atomic_item_no?: number | null
          comment_group_id?: string | null
          comment_part?: number | null
          compliance_reason?: string | null
          compliance_source?: string | null
          contractor_response?: string | null
          created_at?: string
          drawing_number?: string | null
          initial_complied?: boolean
          is_active?: boolean
          link_method?: string | null
          link_scope?: string | null
          link_status?: string | null
          ocs_comment?: string | null
          ocs_number?: string | null
          retired_reason?: string | null
          source_comment_id: string
          source_file_name?: string | null
          source_parent_comment_id: string
          source_row_index?: number | null
          source_sheet_name?: string | null
          split_status?: string | null
          stage_run_id: string
        }
        Update: {
          abd_numbers?: string[]
          assessed_code?: string | null
          atomic_item_count?: number | null
          atomic_item_no?: number | null
          comment_group_id?: string | null
          comment_part?: number | null
          compliance_reason?: string | null
          compliance_source?: string | null
          contractor_response?: string | null
          created_at?: string
          drawing_number?: string | null
          initial_complied?: boolean
          is_active?: boolean
          link_method?: string | null
          link_scope?: string | null
          link_status?: string | null
          ocs_comment?: string | null
          ocs_number?: string | null
          retired_reason?: string | null
          source_comment_id?: string
          source_file_name?: string | null
          source_parent_comment_id?: string
          source_row_index?: number | null
          source_sheet_name?: string | null
          split_status?: string | null
          stage_run_id?: string
        }
        Relationships: []
      }
      abd_ocs_v3_stage_groups: {
        Row: {
          created_at: string
          drawing_number: string | null
          group_contractor_response: string | null
          group_id: string
          item_count: number | null
          ocs_number: string | null
          source_file_name: string | null
          source_parent_comment_id: string
          source_row: number | null
          source_sheet: string | null
          split_status: string | null
          stage_run_id: string
          v3_ocs_number: string | null
        }
        Insert: {
          created_at?: string
          drawing_number?: string | null
          group_contractor_response?: string | null
          group_id: string
          item_count?: number | null
          ocs_number?: string | null
          source_file_name?: string | null
          source_parent_comment_id: string
          source_row?: number | null
          source_sheet?: string | null
          split_status?: string | null
          stage_run_id: string
          v3_ocs_number?: string | null
        }
        Update: {
          created_at?: string
          drawing_number?: string | null
          group_contractor_response?: string | null
          group_id?: string
          item_count?: number | null
          ocs_number?: string | null
          source_file_name?: string | null
          source_parent_comment_id?: string
          source_row?: number | null
          source_sheet?: string | null
          split_status?: string | null
          stage_run_id?: string
          v3_ocs_number?: string | null
        }
        Relationships: []
      }
      abd_ocs_v3_stage_response: {
        Row: {
          atomic_comment_id: string | null
          confidence_score: number | null
          created_at: string
          generic_response: boolean | null
          group_id: string | null
          mapping_method: string | null
          mapping_status: string | null
          response_segment_no: number
          response_source_label: string | null
          response_text: string | null
          source_file_name: string | null
          source_parent_comment_id: string
          source_row: number | null
          source_sheet: string | null
          stage_run_id: string
        }
        Insert: {
          atomic_comment_id?: string | null
          confidence_score?: number | null
          created_at?: string
          generic_response?: boolean | null
          group_id?: string | null
          mapping_method?: string | null
          mapping_status?: string | null
          response_segment_no: number
          response_source_label?: string | null
          response_text?: string | null
          source_file_name?: string | null
          source_parent_comment_id: string
          source_row?: number | null
          source_sheet?: string | null
          stage_run_id: string
        }
        Update: {
          atomic_comment_id?: string | null
          confidence_score?: number | null
          created_at?: string
          generic_response?: boolean | null
          group_id?: string | null
          mapping_method?: string | null
          mapping_status?: string | null
          response_segment_no?: number
          response_source_label?: string | null
          response_text?: string | null
          source_file_name?: string | null
          source_parent_comment_id?: string
          source_row?: number | null
          source_sheet?: string | null
          stage_run_id?: string
        }
        Relationships: []
      }
      abd_resp_result_restore_snapshot_20260727: {
        Row: {
          abd_item_id: string | null
          before_r1: string | null
          before_r2: string | null
          before_r3: string | null
          field: string | null
          restore_value: string | null
          snapshot_at: string | null
        }
        Insert: {
          abd_item_id?: string | null
          before_r1?: string | null
          before_r2?: string | null
          before_r3?: string | null
          field?: string | null
          restore_value?: string | null
          snapshot_at?: string | null
        }
        Update: {
          abd_item_id?: string | null
          before_r1?: string | null
          before_r2?: string | null
          before_r3?: string | null
          field?: string | null
          restore_value?: string | null
          snapshot_at?: string | null
        }
        Relationships: []
      }
      abd_settings: {
        Row: {
          audit_sample_ratio: number
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
          audit_sample_ratio?: number
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
          audit_sample_ratio?: number
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
      comment_read_state: {
        Row: {
          created_at: string
          key: string
          last_read_at: string
          scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          key: string
          last_read_at: string
          scope: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          key?: string
          last_read_at?: string
          scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          actual_dar_inspection_date: string | null
          actual_ho_date: string | null
          actual_pre_inspection_date: string | null
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
          manual_locked_at: string | null
          manual_locked_fields: string[]
          owner_user_id: string | null
          plan_group: string | null
          plan_title: string | null
          planned_closure_date: string | null
          planned_dar_inspection_date: string | null
          planned_ho_date: string | null
          planned_pre_inspection_date: string | null
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
          actual_dar_inspection_date?: string | null
          actual_ho_date?: string | null
          actual_pre_inspection_date?: string | null
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
          manual_locked_at?: string | null
          manual_locked_fields?: string[]
          owner_user_id?: string | null
          plan_group?: string | null
          plan_title?: string | null
          planned_closure_date?: string | null
          planned_dar_inspection_date?: string | null
          planned_ho_date?: string | null
          planned_pre_inspection_date?: string | null
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
          actual_dar_inspection_date?: string | null
          actual_ho_date?: string | null
          actual_pre_inspection_date?: string | null
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
          manual_locked_at?: string | null
          manual_locked_fields?: string[]
          owner_user_id?: string | null
          plan_group?: string | null
          plan_title?: string | null
          planned_closure_date?: string | null
          planned_dar_inspection_date?: string | null
          planned_ho_date?: string | null
          planned_pre_inspection_date?: string | null
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
      defect_stage_backfill_snapshot_20260809: {
        Row: {
          actual_closure_date: string | null
          created_at: string
          id: string
          prev_actual_dar_inspection_date: string | null
          prev_actual_pre_inspection_date: string | null
          prev_planned_dar_inspection_date: string | null
          prev_planned_pre_inspection_date: string | null
        }
        Insert: {
          actual_closure_date?: string | null
          created_at?: string
          id: string
          prev_actual_dar_inspection_date?: string | null
          prev_actual_pre_inspection_date?: string | null
          prev_planned_dar_inspection_date?: string | null
          prev_planned_pre_inspection_date?: string | null
        }
        Update: {
          actual_closure_date?: string | null
          created_at?: string
          id?: string
          prev_actual_dar_inspection_date?: string | null
          prev_actual_pre_inspection_date?: string | null
          prev_planned_dar_inspection_date?: string | null
          prev_planned_pre_inspection_date?: string | null
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
          headcount_kind: string
          id: string
          manpower: number | null
          metric: string | null
          pic_name: string | null
          plan_manpower: number | null
          plot: string
          report_date: string
          snapshot_at: string | null
          source_image_path: string | null
          system_id: string | null
          system_name: string
          tactual_pct: number | null
          task_actual_start: string | null
          task_data_date: string | null
          task_level: string | null
          task_name: string | null
          task_no: string | null
          tc_actual_pct: number | null
          tc_plan_pct: number | null
          tplan_pct: number | null
          updated_at: string
          work_category: string | null
        }
        Insert: {
          actual_manpower?: number | null
          contractor_id?: string | null
          contractor_name: string
          created_at?: string
          created_by?: string | null
          diff_manpower?: number | null
          discipline: string
          headcount_kind?: string
          id?: string
          manpower?: number | null
          metric?: string | null
          pic_name?: string | null
          plan_manpower?: number | null
          plot: string
          report_date: string
          snapshot_at?: string | null
          source_image_path?: string | null
          system_id?: string | null
          system_name: string
          tactual_pct?: number | null
          task_actual_start?: string | null
          task_data_date?: string | null
          task_level?: string | null
          task_name?: string | null
          task_no?: string | null
          tc_actual_pct?: number | null
          tc_plan_pct?: number | null
          tplan_pct?: number | null
          updated_at?: string
          work_category?: string | null
        }
        Update: {
          actual_manpower?: number | null
          contractor_id?: string | null
          contractor_name?: string
          created_at?: string
          created_by?: string | null
          diff_manpower?: number | null
          discipline?: string
          headcount_kind?: string
          id?: string
          manpower?: number | null
          metric?: string | null
          pic_name?: string | null
          plan_manpower?: number | null
          plot?: string
          report_date?: string
          snapshot_at?: string | null
          source_image_path?: string | null
          system_id?: string | null
          system_name?: string
          tactual_pct?: number | null
          task_actual_start?: string | null
          task_data_date?: string | null
          task_level?: string | null
          task_name?: string | null
          task_no?: string | null
          tc_actual_pct?: number | null
          tc_plan_pct?: number | null
          tplan_pct?: number | null
          updated_at?: string
          work_category?: string | null
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
      dmr_entry_templates: {
        Row: {
          row_count: number
          rows: Json
          scope: string
          updated_at: string
          updated_by: string | null
          updated_by_name: string | null
        }
        Insert: {
          row_count?: number
          rows?: Json
          scope: string
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Update: {
          row_count?: number
          rows?: Json
          scope?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Relationships: []
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
          last_seen_at: string | null
          linked_user_id: string | null
          merged_into_id: string | null
          name: string
          name_norm: string
          name_variants: string[]
          note: string | null
          updated_at: string
          verified: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          linked_user_id?: string | null
          merged_into_id?: string | null
          name: string
          name_norm: string
          name_variants?: string[]
          note?: string | null
          updated_at?: string
          verified?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          linked_user_id?: string | null
          merged_into_id?: string | null
          name?: string
          name_norm?: string
          name_variants?: string[]
          note?: string | null
          updated_at?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "hdec_eng_name_master_linked_user_id_fkey"
            columns: ["linked_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hdec_eng_name_master_merged_into_fk"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "hdec_eng_name_master"
            referencedColumns: ["id"]
          },
        ]
      }
      hdec_name_propagation_log: {
        Row: {
          created_at: string
          from_name: string | null
          id: string
          owned_rows: number
          ref_id: string | null
          source: string
          target_column: string
          target_table: string
          to_name: string | null
          unowned_rows: number
        }
        Insert: {
          created_at?: string
          from_name?: string | null
          id?: string
          owned_rows?: number
          ref_id?: string | null
          source: string
          target_column: string
          target_table: string
          to_name?: string | null
          unowned_rows?: number
        }
        Update: {
          created_at?: string
          from_name?: string | null
          id?: string
          owned_rows?: number
          ref_id?: string | null
          source?: string
          target_column?: string
          target_table?: string
          to_name?: string | null
          unowned_rows?: number
        }
        Relationships: []
      }
      hdec_pic_name_master: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_seen_at: string | null
          linked_user_id: string | null
          merged_into_id: string | null
          name: string
          name_norm: string
          name_variants: string[]
          note: string | null
          updated_at: string
          verified: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          linked_user_id?: string | null
          merged_into_id?: string | null
          name: string
          name_norm: string
          name_variants?: string[]
          note?: string | null
          updated_at?: string
          verified?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          linked_user_id?: string | null
          merged_into_id?: string | null
          name?: string
          name_norm?: string
          name_variants?: string[]
          note?: string | null
          updated_at?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "hdec_pic_name_master_linked_user_id_fkey"
            columns: ["linked_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hdec_pic_name_master_merged_into_fk"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "hdec_pic_name_master"
            referencedColumns: ["id"]
          },
        ]
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
      pdb_module_filters: {
        Row: {
          filters: Json
          module: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          filters?: Json
          module: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          filters?: Json
          module?: string
          updated_at?: string
          updated_by?: string | null
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
          name: string
          name_norm: string | null
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
          name: string
          name_norm?: string | null
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
          name?: string
          name_norm?: string | null
          subcontractor_name?: string | null
          subsub_name?: string | null
          team?: string | null
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"]
        }
        Relationships: []
      }
      rcl_legacy_fn_backup: {
        Row: {
          backed_up_at: string
          fn_args: string
          fn_def: string
          fn_name: string
          id: string
        }
        Insert: {
          backed_up_at?: string
          fn_args: string
          fn_def: string
          fn_name: string
          id?: string
        }
        Update: {
          backed_up_at?: string
          fn_args?: string
          fn_def?: string
          fn_name?: string
          id?: string
        }
        Relationships: []
      }
      rcl_module_config: {
        Row: {
          created_at: string
          module: string
          owner_cols: string[]
          owning_team: string | null
          table_name: string
          team_col: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          module: string
          owner_cols: string[]
          owning_team?: string | null
          table_name: string
          team_col?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          module?: string
          owner_cols?: string[]
          owning_team?: string | null
          table_name?: string
          team_col?: string
          updated_at?: string
        }
        Relationships: []
      }
      rcl_module_config_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          id: string
          module: string
          new_team: string | null
          old_team: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          id?: string
          module: string
          new_team?: string | null
          old_team?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          id?: string
          module?: string
          new_team?: string | null
          old_team?: string | null
        }
        Relationships: []
      }
      rcl_permissions: {
        Row: {
          action: string
          allowed: boolean
          created_at: string
          role: Database["public"]["Enums"]["app_role"]
          scope: string
          updated_at: string
        }
        Insert: {
          action: string
          allowed?: boolean
          created_at?: string
          role: Database["public"]["Enums"]["app_role"]
          scope: string
          updated_at?: string
        }
        Update: {
          action?: string
          allowed?: boolean
          created_at?: string
          role?: Database["public"]["Enums"]["app_role"]
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      rcl_permissions_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          id: string
          new_allowed: boolean | null
          old_allowed: boolean | null
          op: string
          role: Database["public"]["Enums"]["app_role"]
          scope: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          id?: string
          new_allowed?: boolean | null
          old_allowed?: boolean | null
          op: string
          role: Database["public"]["Enums"]["app_role"]
          scope: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          id?: string
          new_allowed?: boolean | null
          old_allowed?: boolean | null
          op?: string
          role?: Database["public"]["Enums"]["app_role"]
          scope?: string
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
      spare_part_change_log_archived: {
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
            referencedRelation: "spare_parts_import_logs_archived"
            referencedColumns: ["id"]
          },
        ]
      }
      spare_part_comments_archived: {
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
            referencedRelation: "spare_parts_raw_archived"
            referencedColumns: ["doc_ref"]
          },
        ]
      }
      spare_part_custom_fields_archived: {
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
      spare_part_field_config_archived: {
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
      spare_part_header_mappings_archived: {
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
      spare_part_import_row_logs_archived: {
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
            referencedRelation: "spare_parts_import_logs_archived"
            referencedColumns: ["id"]
          },
        ]
      }
      spare_part_status_history_archived: {
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
            referencedRelation: "spare_parts_raw_archived"
            referencedColumns: ["doc_ref"]
          },
          {
            foreignKeyName: "spare_part_status_history_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "spare_part_status_history_archived"
            referencedColumns: ["id"]
          },
        ]
      }
      spare_part_status_mapping_archived: {
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
      spare_parts_import_logs_archived: {
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
      spare_parts_raw_archived: {
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
            referencedRelation: "spare_parts_import_logs_archived"
            referencedColumns: ["id"]
          },
        ]
      }
      spare_parts_sync_log_archived: {
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
      spl_change_log: {
        Row: {
          action: string
          batch_id: string | null
          changed_at: string
          changed_by: string | null
          column_name: string | null
          id: string
          item_id: string | null
          new_value: string | null
          old_value: string | null
          row_id: string
          source: string
          spl_number: string | null
          stage_code: string | null
          table_name: string
        }
        Insert: {
          action: string
          batch_id?: string | null
          changed_at?: string
          changed_by?: string | null
          column_name?: string | null
          id?: string
          item_id?: string | null
          new_value?: string | null
          old_value?: string | null
          row_id: string
          source?: string
          spl_number?: string | null
          stage_code?: string | null
          table_name: string
        }
        Update: {
          action?: string
          batch_id?: string | null
          changed_at?: string
          changed_by?: string | null
          column_name?: string | null
          id?: string
          item_id?: string | null
          new_value?: string | null
          old_value?: string | null
          row_id?: string
          source?: string
          spl_number?: string | null
          stage_code?: string | null
          table_name?: string
        }
        Relationships: []
      }
      spl_document_item_links: {
        Row: {
          created_at: string
          document_id: string
          id: string
          mapping_method: string | null
          note: string | null
          page_hint: number | null
          spl_item_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          mapping_method?: string | null
          note?: string | null
          page_hint?: number | null
          spl_item_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          mapping_method?: string | null
          note?: string | null
          page_hint?: number | null
          spl_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spl_document_item_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "spl_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_document_item_links_spl_item_id_fkey"
            columns: ["spl_item_id"]
            isOneToOne: false
            referencedRelation: "spl_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_document_item_links_spl_item_id_fkey"
            columns: ["spl_item_id"]
            isOneToOne: false
            referencedRelation: "spl_items_judged"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_document_item_links_spl_item_id_fkey"
            columns: ["spl_item_id"]
            isOneToOne: false
            referencedRelation: "spl_precedence_violations"
            referencedColumns: ["item_id"]
          },
        ]
      }
      spl_document_pages: {
        Row: {
          created_at: string
          document_id: string
          extracted_text: string
          extraction_version: string
          id: string
          normalized_text: string
          page_number: number
          text_hash: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_id: string
          extracted_text?: string
          extraction_version: string
          id?: string
          normalized_text?: string
          page_number: number
          text_hash: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_id?: string
          extracted_text?: string
          extraction_version?: string
          id?: string
          normalized_text?: string
          page_number?: number
          text_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spl_document_pages_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "spl_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      spl_documents: {
        Row: {
          byte_size: number | null
          content_hash: string | null
          created_at: string
          document_identity: string
          document_number: string | null
          file_name: string
          filename_document_number: string | null
          id: string
          import_log_id: string | null
          internal_document_number: string | null
          is_active: boolean
          is_ocr: boolean
          mismatch_warning: string | null
          number_mismatch: boolean
          ocr_engine: string | null
          ocr_language: string | null
          ocr_processed_at: string | null
          ocr_text_hash: string | null
          page_count: number | null
          review_note: string | null
          revision: string | null
          storage_path: string
          title: string | null
          updated_at: string
        }
        Insert: {
          byte_size?: number | null
          content_hash?: string | null
          created_at?: string
          document_identity: string
          document_number?: string | null
          file_name: string
          filename_document_number?: string | null
          id?: string
          import_log_id?: string | null
          internal_document_number?: string | null
          is_active?: boolean
          is_ocr?: boolean
          mismatch_warning?: string | null
          number_mismatch?: boolean
          ocr_engine?: string | null
          ocr_language?: string | null
          ocr_processed_at?: string | null
          ocr_text_hash?: string | null
          page_count?: number | null
          review_note?: string | null
          revision?: string | null
          storage_path: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          byte_size?: number | null
          content_hash?: string | null
          created_at?: string
          document_identity?: string
          document_number?: string | null
          file_name?: string
          filename_document_number?: string | null
          id?: string
          import_log_id?: string | null
          internal_document_number?: string | null
          is_active?: boolean
          is_ocr?: boolean
          mismatch_warning?: string | null
          number_mismatch?: boolean
          ocr_engine?: string | null
          ocr_language?: string | null
          ocr_processed_at?: string | null
          ocr_text_hash?: string | null
          page_count?: number | null
          review_note?: string | null
          revision?: string | null
          storage_path?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      spl_field_config: {
        Row: {
          created_at: string
          data_type: string
          editable: boolean
          field_key: string
          group: string | null
          id: string
          label: string
          options: Json | null
          sort_order: number
          source_group: string
          updated_at: string
          visible: boolean
        }
        Insert: {
          created_at?: string
          data_type?: string
          editable?: boolean
          field_key: string
          group?: string | null
          id?: string
          label: string
          options?: Json | null
          sort_order?: number
          source_group?: string
          updated_at?: string
          visible?: boolean
        }
        Update: {
          created_at?: string
          data_type?: string
          editable?: boolean
          field_key?: string
          group?: string | null
          id?: string
          label?: string
          options?: Json | null
          sort_order?: number
          source_group?: string
          updated_at?: string
          visible?: boolean
        }
        Relationships: []
      }
      spl_header_mappings: {
        Row: {
          created_at: string
          form: string
          id: string
          is_active: boolean
          is_custom: boolean
          note: string | null
          plan_or_actual: string | null
          source_header: string
          stage: string | null
          target_field: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          form: string
          id?: string
          is_active?: boolean
          is_custom?: boolean
          note?: string | null
          plan_or_actual?: string | null
          source_header: string
          stage?: string | null
          target_field: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          form?: string
          id?: string
          is_active?: boolean
          is_custom?: boolean
          note?: string | null
          plan_or_actual?: string | null
          source_header?: string
          stage?: string | null
          target_field?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      spl_import_logs: {
        Row: {
          cleared_values: number
          created_at: string
          file_name: string
          finished_at: string | null
          id: string
          imported_by: string | null
          items_updated: number
          matched: number
          note: string | null
          ocs_excluded: number
          sheet_names: string[]
          stages_upserted: number
          started_at: string
          status: string
          total_rows: number
          unmatched: number
          updated_at: string
        }
        Insert: {
          cleared_values?: number
          created_at?: string
          file_name: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          items_updated?: number
          matched?: number
          note?: string | null
          ocs_excluded?: number
          sheet_names?: string[]
          stages_upserted?: number
          started_at?: string
          status?: string
          total_rows?: number
          unmatched?: number
          updated_at?: string
        }
        Update: {
          cleared_values?: number
          created_at?: string
          file_name?: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          items_updated?: number
          matched?: number
          note?: string | null
          ocs_excluded?: number
          sheet_names?: string[]
          stages_upserted?: number
          started_at?: string
          status?: string
          total_rows?: number
          unmatched?: number
          updated_at?: string
        }
        Relationships: []
      }
      spl_import_presets: {
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
      spl_import_row_logs: {
        Row: {
          batch_id: string
          changes: Json
          code: string | null
          created_at: string
          detail: string | null
          excel_row: number | null
          id: string
          outcome: string
          sheet_name: string | null
          spl_number: string | null
        }
        Insert: {
          batch_id: string
          changes?: Json
          code?: string | null
          created_at?: string
          detail?: string | null
          excel_row?: number | null
          id?: string
          outcome: string
          sheet_name?: string | null
          spl_number?: string | null
        }
        Update: {
          batch_id?: string
          changes?: Json
          code?: string | null
          created_at?: string
          detail?: string | null
          excel_row?: number | null
          id?: string
          outcome?: string
          sheet_name?: string | null
          spl_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spl_import_row_logs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "spl_import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      spl_items: {
        Row: {
          approval_status_raw: string | null
          created_at: string
          created_by: string | null
          data_date: string | null
          dis: string | null
          document_total: number
          eng: string | null
          eng_po: string | null
          exclusion_reason: string | null
          id: string
          is_active: boolean
          is_excluded: boolean
          latest_status: string | null
          latest_status_raw: string | null
          ocs_check: number
          ocs_complied: number
          ocs_pending: number
          ocs_total: number
          owner_user_id: string | null
          pic: string | null
          pic_po: string | null
          plot: string
          revision: string | null
          rsp_total: number
          service: string | null
          source_file: string | null
          spl_number: string
          supplier: string | null
          team: string | null
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approval_status_raw?: string | null
          created_at?: string
          created_by?: string | null
          data_date?: string | null
          dis?: string | null
          document_total?: number
          eng?: string | null
          eng_po?: string | null
          exclusion_reason?: string | null
          id?: string
          is_active?: boolean
          is_excluded?: boolean
          latest_status?: string | null
          latest_status_raw?: string | null
          ocs_check?: number
          ocs_complied?: number
          ocs_pending?: number
          ocs_total?: number
          owner_user_id?: string | null
          pic?: string | null
          pic_po?: string | null
          plot: string
          revision?: string | null
          rsp_total?: number
          service?: string | null
          source_file?: string | null
          spl_number: string
          supplier?: string | null
          team?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approval_status_raw?: string | null
          created_at?: string
          created_by?: string | null
          data_date?: string | null
          dis?: string | null
          document_total?: number
          eng?: string | null
          eng_po?: string | null
          exclusion_reason?: string | null
          id?: string
          is_active?: boolean
          is_excluded?: boolean
          latest_status?: string | null
          latest_status_raw?: string | null
          ocs_check?: number
          ocs_complied?: number
          ocs_pending?: number
          ocs_total?: number
          owner_user_id?: string | null
          pic?: string | null
          pic_po?: string | null
          plot?: string
          revision?: string | null
          rsp_total?: number
          service?: string | null
          source_file?: string | null
          spl_number?: string
          supplier?: string | null
          team?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      spl_ocs_attachment_comment_links: {
        Row: {
          attachment_id: string
          comment_id: string
          confidence: number | null
          created_at: string
          id: string
          mapping_method: string | null
          scope: string | null
        }
        Insert: {
          attachment_id: string
          comment_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          mapping_method?: string | null
          scope?: string | null
        }
        Update: {
          attachment_id?: string
          comment_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          mapping_method?: string | null
          scope?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spl_ocs_attachment_comment_links_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "spl_ocs_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_ocs_attachment_comment_links_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "spl_ocs_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      spl_ocs_attachments: {
        Row: {
          byte_size: number | null
          content_hash: string | null
          created_at: string
          format: string | null
          height: number | null
          id: string
          import_log_id: string | null
          is_active: boolean
          source_anchor: string | null
          source_attachment_identity: string
          source_file_name: string | null
          source_sheet: string | null
          storage_path: string
          updated_at: string
          width: number | null
        }
        Insert: {
          byte_size?: number | null
          content_hash?: string | null
          created_at?: string
          format?: string | null
          height?: number | null
          id?: string
          import_log_id?: string | null
          is_active?: boolean
          source_anchor?: string | null
          source_attachment_identity: string
          source_file_name?: string | null
          source_sheet?: string | null
          storage_path: string
          updated_at?: string
          width?: number | null
        }
        Update: {
          byte_size?: number | null
          content_hash?: string | null
          created_at?: string
          format?: string | null
          height?: number | null
          id?: string
          import_log_id?: string | null
          is_active?: boolean
          source_anchor?: string | null
          source_attachment_identity?: string
          source_file_name?: string | null
          source_sheet?: string | null
          storage_path?: string
          updated_at?: string
          width?: number | null
        }
        Relationships: []
      }
      spl_ocs_categories: {
        Row: {
          code: string
          color: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_user_created: boolean
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_user_created?: boolean
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_user_created?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      spl_ocs_categories_mapping: {
        Row: {
          category_id: string
          comment_id: string
          confidence: number | null
          created_at: string
          id: string
          note: string | null
          source: string
        }
        Insert: {
          category_id: string
          comment_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          note?: string | null
          source?: string
        }
        Update: {
          category_id?: string
          comment_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          note?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "spl_ocs_categories_mapping_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "spl_ocs_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_ocs_categories_mapping_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "spl_ocs_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      spl_ocs_comment_document_links: {
        Row: {
          comment_id: string
          confidence: number | null
          created_at: string
          document_id: string
          id: string
          mapping_method: string | null
          note: string | null
          page_number: number | null
        }
        Insert: {
          comment_id: string
          confidence?: number | null
          created_at?: string
          document_id: string
          id?: string
          mapping_method?: string | null
          note?: string | null
          page_number?: number | null
        }
        Update: {
          comment_id?: string
          confidence?: number | null
          created_at?: string
          document_id?: string
          id?: string
          mapping_method?: string | null
          note?: string | null
          page_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "spl_ocs_comment_document_links_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "spl_ocs_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_ocs_comment_document_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "spl_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      spl_ocs_comment_groups: {
        Row: {
          created_at: string
          id: string
          import_log_id: string | null
          is_active: boolean
          ocs_number: string | null
          raw_comment_text: string | null
          revision: string | null
          source_file_name: string | null
          source_group_identity: string
          source_hash: string | null
          source_row: number | null
          source_sheet: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          import_log_id?: string | null
          is_active?: boolean
          ocs_number?: string | null
          raw_comment_text?: string | null
          revision?: string | null
          source_file_name?: string | null
          source_group_identity: string
          source_hash?: string | null
          source_row?: number | null
          source_sheet?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          import_log_id?: string | null
          is_active?: boolean
          ocs_number?: string | null
          raw_comment_text?: string | null
          revision?: string | null
          source_file_name?: string | null
          source_group_identity?: string
          source_hash?: string | null
          source_row?: number | null
          source_sheet?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      spl_ocs_comment_rsp_links: {
        Row: {
          comment_id: string
          confidence: number | null
          created_at: string
          id: string
          mapping_method: string | null
          note: string | null
          rsp_item_id: string
          scope: string
        }
        Insert: {
          comment_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          mapping_method?: string | null
          note?: string | null
          rsp_item_id: string
          scope?: string
        }
        Update: {
          comment_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          mapping_method?: string | null
          note?: string | null
          rsp_item_id?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "spl_ocs_comment_rsp_links_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "spl_ocs_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_ocs_comment_rsp_links_rsp_item_id_fkey"
            columns: ["rsp_item_id"]
            isOneToOne: false
            referencedRelation: "spl_rsp_items"
            referencedColumns: ["id"]
          },
        ]
      }
      spl_ocs_comment_spl_links: {
        Row: {
          comment_id: string
          confidence: number | null
          created_at: string
          id: string
          mapping_method: string | null
          note: string | null
          spl_item_id: string
        }
        Insert: {
          comment_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          mapping_method?: string | null
          note?: string | null
          spl_item_id: string
        }
        Update: {
          comment_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          mapping_method?: string | null
          note?: string | null
          spl_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spl_ocs_comment_spl_links_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "spl_ocs_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_ocs_comment_spl_links_spl_item_id_fkey"
            columns: ["spl_item_id"]
            isOneToOne: false
            referencedRelation: "spl_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_ocs_comment_spl_links_spl_item_id_fkey"
            columns: ["spl_item_id"]
            isOneToOne: false
            referencedRelation: "spl_items_judged"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_ocs_comment_spl_links_spl_item_id_fkey"
            columns: ["spl_item_id"]
            isOneToOne: false
            referencedRelation: "spl_precedence_violations"
            referencedColumns: ["item_id"]
          },
        ]
      }
      spl_ocs_comments: {
        Row: {
          assessed_code: string | null
          atomic_item_count: number | null
          atomic_item_no: number | null
          comment_text: string | null
          contractor_response: string | null
          created_at: string
          group_id: string | null
          id: string
          import_log_id: string | null
          is_active: boolean
          is_resolved: boolean
          ocs_number: string | null
          resolved_reason: string | null
          response_mapping_status: string | null
          revision: string | null
          sign_off_status: string | null
          source_comment_id: string
          source_hash: string | null
          source_row: number | null
          source_sheet: string | null
          superseded_at: string | null
          superseded_by: string | null
          updated_at: string
        }
        Insert: {
          assessed_code?: string | null
          atomic_item_count?: number | null
          atomic_item_no?: number | null
          comment_text?: string | null
          contractor_response?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          import_log_id?: string | null
          is_active?: boolean
          is_resolved?: boolean
          ocs_number?: string | null
          resolved_reason?: string | null
          response_mapping_status?: string | null
          revision?: string | null
          sign_off_status?: string | null
          source_comment_id: string
          source_hash?: string | null
          source_row?: number | null
          source_sheet?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          updated_at?: string
        }
        Update: {
          assessed_code?: string | null
          atomic_item_count?: number | null
          atomic_item_no?: number | null
          comment_text?: string | null
          contractor_response?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          import_log_id?: string | null
          is_active?: boolean
          is_resolved?: boolean
          ocs_number?: string | null
          resolved_reason?: string | null
          response_mapping_status?: string | null
          revision?: string | null
          sign_off_status?: string | null
          source_comment_id?: string
          source_hash?: string | null
          source_row?: number | null
          source_sheet?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spl_ocs_comments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "spl_ocs_comment_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_ocs_comments_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "spl_ocs_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      spl_ocs_compliance: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          comment_id: string
          complied: boolean
          created_at: string
          source: string
          updated_at: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          comment_id: string
          complied?: boolean
          created_at?: string
          source?: string
          updated_at?: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          comment_id?: string
          complied?: boolean
          created_at?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spl_ocs_compliance_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: true
            referencedRelation: "spl_ocs_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      spl_ocs_compliance_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          comment_id: string
          id: string
          new_value: boolean | null
          old_value: boolean | null
          source: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          comment_id: string
          id?: string
          new_value?: boolean | null
          old_value?: boolean | null
          source: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          comment_id?: string
          id?: string
          new_value?: boolean | null
          old_value?: boolean | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "spl_ocs_compliance_log_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "spl_ocs_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      spl_ocs_import_logs: {
        Row: {
          counts: Json
          created_at: string
          errors: Json
          file_name: string | null
          finished_at: string | null
          id: string
          imported_by: string | null
          imported_by_name: string | null
          package_hash: string | null
          result: Json
          snapshot_id: string | null
          stage: string | null
          started_at: string
          status: string
          updated_at: string
          warnings: Json
        }
        Insert: {
          counts?: Json
          created_at?: string
          errors?: Json
          file_name?: string | null
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          imported_by_name?: string | null
          package_hash?: string | null
          result?: Json
          snapshot_id?: string | null
          stage?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          warnings?: Json
        }
        Update: {
          counts?: Json
          created_at?: string
          errors?: Json
          file_name?: string | null
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          imported_by_name?: string | null
          package_hash?: string | null
          result?: Json
          snapshot_id?: string | null
          stage?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          warnings?: Json
        }
        Relationships: []
      }
      spl_ocs_source_files: {
        Row: {
          byte_size: number | null
          content_hash: string | null
          created_at: string
          file_name: string
          id: string
          import_log_id: string | null
          is_active: boolean
          ocs_number: string | null
          revision: string | null
          source_file_identity: string
          storage_path: string
          superseded_at: string | null
          superseded_by: string | null
          updated_at: string
        }
        Insert: {
          byte_size?: number | null
          content_hash?: string | null
          created_at?: string
          file_name: string
          id?: string
          import_log_id?: string | null
          is_active?: boolean
          ocs_number?: string | null
          revision?: string | null
          source_file_identity: string
          storage_path: string
          superseded_at?: string | null
          superseded_by?: string | null
          updated_at?: string
        }
        Update: {
          byte_size?: number | null
          content_hash?: string | null
          created_at?: string
          file_name?: string
          id?: string
          import_log_id?: string | null
          is_active?: boolean
          ocs_number?: string | null
          revision?: string | null
          source_file_identity?: string
          storage_path?: string
          superseded_at?: string | null
          superseded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spl_ocs_source_files_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "spl_ocs_source_files"
            referencedColumns: ["id"]
          },
        ]
      }
      spl_ocs_v1_stage: {
        Row: {
          id: number
          kind: string
          payload: Json
        }
        Insert: {
          id?: number
          kind: string
          payload: Json
        }
        Update: {
          id?: number
          kind?: string
          payload?: Json
        }
        Relationships: []
      }
      spl_owner_backfill_snapshot_20260804: {
        Row: {
          eng: string | null
          eng_po: string | null
          id: string | null
          owner_user_id: string | null
          pic: string | null
          pic_po: string | null
          snapshot_at: string | null
          spl_number: string | null
        }
        Insert: {
          eng?: string | null
          eng_po?: string | null
          id?: string | null
          owner_user_id?: string | null
          pic?: string | null
          pic_po?: string | null
          snapshot_at?: string | null
          spl_number?: string | null
        }
        Update: {
          eng?: string | null
          eng_po?: string | null
          id?: string | null
          owner_user_id?: string | null
          pic?: string | null
          pic_po?: string | null
          snapshot_at?: string | null
          spl_number?: string | null
        }
        Relationships: []
      }
      spl_rsp_items: {
        Row: {
          created_at: string
          description: string | null
          id: string
          import_log_id: string | null
          inactive_at: string | null
          inactive_reason: string | null
          is_active: boolean
          manufacturer: string | null
          model_or_unique_id: string | null
          qty_available: number | null
          qty_required: number | null
          qty_short: number | null
          rsp_number: string
          sort_order: number
          source_hash: string | null
          source_identity: string | null
          source_row: number | null
          source_sheet: string | null
          spl_item_id: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          import_log_id?: string | null
          inactive_at?: string | null
          inactive_reason?: string | null
          is_active?: boolean
          manufacturer?: string | null
          model_or_unique_id?: string | null
          qty_available?: number | null
          qty_required?: number | null
          qty_short?: number | null
          rsp_number: string
          sort_order?: number
          source_hash?: string | null
          source_identity?: string | null
          source_row?: number | null
          source_sheet?: string | null
          spl_item_id: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          import_log_id?: string | null
          inactive_at?: string | null
          inactive_reason?: string | null
          is_active?: boolean
          manufacturer?: string | null
          model_or_unique_id?: string | null
          qty_available?: number | null
          qty_required?: number | null
          qty_short?: number | null
          rsp_number?: string
          sort_order?: number
          source_hash?: string | null
          source_identity?: string | null
          source_row?: number | null
          source_sheet?: string | null
          spl_item_id?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spl_rsp_items_spl_item_id_fkey"
            columns: ["spl_item_id"]
            isOneToOne: false
            referencedRelation: "spl_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_rsp_items_spl_item_id_fkey"
            columns: ["spl_item_id"]
            isOneToOne: false
            referencedRelation: "spl_items_judged"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_rsp_items_spl_item_id_fkey"
            columns: ["spl_item_id"]
            isOneToOne: false
            referencedRelation: "spl_precedence_violations"
            referencedColumns: ["item_id"]
          },
        ]
      }
      spl_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      spl_stage_catalog: {
        Row: {
          actual_authority: string
          band: string
          chain_excluded: boolean
          created_at: string
          in_progress_denominator: boolean
          label: string
          module: string
          note: string | null
          round_no: number | null
          short_code: string
          sort_order: number
          stage_code: string
          updated_at: string
          value_type: string
        }
        Insert: {
          actual_authority?: string
          band: string
          chain_excluded?: boolean
          created_at?: string
          in_progress_denominator?: boolean
          label: string
          module?: string
          note?: string | null
          round_no?: number | null
          short_code: string
          sort_order: number
          stage_code: string
          updated_at?: string
          value_type: string
        }
        Update: {
          actual_authority?: string
          band?: string
          chain_excluded?: boolean
          created_at?: string
          in_progress_denominator?: boolean
          label?: string
          module?: string
          note?: string | null
          round_no?: number | null
          short_code?: string
          sort_order?: number
          stage_code?: string
          updated_at?: string
          value_type?: string
        }
        Relationships: []
      }
      spl_stage_progress: {
        Row: {
          actual_estimated: boolean
          actual_finish: string | null
          actual_start: string | null
          backfill_batch_id: string | null
          created_at: string
          created_by: string | null
          data_date: string | null
          flag_value: string | null
          id: string
          item_id: string
          na_flag: boolean
          plan_finish: string | null
          plan_start: string | null
          remarks: string | null
          stage_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actual_estimated?: boolean
          actual_finish?: string | null
          actual_start?: string | null
          backfill_batch_id?: string | null
          created_at?: string
          created_by?: string | null
          data_date?: string | null
          flag_value?: string | null
          id?: string
          item_id: string
          na_flag?: boolean
          plan_finish?: string | null
          plan_start?: string | null
          remarks?: string | null
          stage_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actual_estimated?: boolean
          actual_finish?: string | null
          actual_start?: string | null
          backfill_batch_id?: string | null
          created_at?: string
          created_by?: string | null
          data_date?: string | null
          flag_value?: string | null
          id?: string
          item_id?: string
          na_flag?: boolean
          plan_finish?: string | null
          plan_start?: string | null
          remarks?: string | null
          stage_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spl_stage_progress_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "spl_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_stage_progress_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "spl_items_judged"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spl_stage_progress_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "spl_precedence_violations"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "spl_stage_progress_stage_code_fkey"
            columns: ["stage_code"]
            isOneToOne: false
            referencedRelation: "spl_precedence_violations"
            referencedColumns: ["stage_code"]
          },
          {
            foreignKeyName: "spl_stage_progress_stage_code_fkey"
            columns: ["stage_code"]
            isOneToOne: false
            referencedRelation: "spl_stage_catalog"
            referencedColumns: ["stage_code"]
          },
        ]
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
          recipient_names: string[]
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
          recipient_names?: string[]
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
          recipient_names?: string[]
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
          {
            foreignKeyName: "task_comments_task_raw_id_fkey"
            columns: ["task_raw_id"]
            isOneToOne: false
            referencedRelation: "v_task_management_raw_derived"
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
          applied_rows: number | null
          created_at: string
          data_date: string | null
          discipline: string
          errors: Json | null
          exclusions: Json | null
          file_name: string
          finished_at: string | null
          id: string
          imported_by: string | null
          inserted: number
          note: string | null
          parsed_rows: number | null
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
          warnings: Json | null
        }
        Insert: {
          applied_rows?: number | null
          created_at?: string
          data_date?: string | null
          discipline: string
          errors?: Json | null
          exclusions?: Json | null
          file_name: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          inserted?: number
          note?: string | null
          parsed_rows?: number | null
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
          warnings?: Json | null
        }
        Update: {
          applied_rows?: number | null
          created_at?: string
          data_date?: string | null
          discipline?: string
          errors?: Json | null
          exclusions?: Json | null
          file_name?: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          inserted?: number
          note?: string | null
          parsed_rows?: number | null
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
          warnings?: Json | null
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
          actual_finish_source: string | null
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
          milestone: string | null
          owner_user_id: string | null
          plan_days: number | null
          plan_end: string | null
          plan_progress: number | null
          plan_start: string | null
          plot: string | null
          progress_observed_at: string | null
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
          actual_finish_source?: string | null
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
          milestone?: string | null
          owner_user_id?: string | null
          plan_days?: number | null
          plan_end?: string | null
          plan_progress?: number | null
          plan_start?: string | null
          plot?: string | null
          progress_observed_at?: string | null
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
          actual_finish_source?: string | null
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
          milestone?: string | null
          owner_user_id?: string | null
          plan_days?: number | null
          plan_end?: string | null
          plan_progress?: number | null
          plan_start?: string | null
          plot?: string | null
          progress_observed_at?: string | null
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
            foreignKeyName: "task_management_raw_milestone_fk"
            columns: ["milestone"]
            isOneToOne: false
            referencedRelation: "tm_milestone_kinds"
            referencedColumns: ["kind_code"]
          },
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
            foreignKeyName: "task_management_status_history_task_raw_id_fkey"
            columns: ["task_raw_id"]
            isOneToOne: false
            referencedRelation: "v_task_management_raw_derived"
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
      tm_alarm_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value_int: number | null
          value_num: number | null
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value_int?: number | null
          value_num?: number | null
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value_int?: number | null
          value_num?: number | null
        }
        Relationships: []
      }
      tm_milestone_config: {
        Row: {
          kind: string
          plot: string
          target_date: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          kind: string
          plot: string
          target_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          kind?: string
          plot?: string
          target_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      tm_milestone_config_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          kind: string
          new_date: string | null
          old_date: string | null
          plot: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          kind: string
          new_date?: string | null
          old_date?: string | null
          plot: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          kind?: string
          new_date?: string | null
          old_date?: string | null
          plot?: string
        }
        Relationships: []
      }
      tm_milestone_kinds: {
        Row: {
          created_at: string
          deleted_at: string | null
          is_active: boolean
          kind_code: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          is_active?: boolean
          kind_code: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          is_active?: boolean
          kind_code?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      tm_pic_delegations: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          from_pic: string
          from_pic_norm: string | null
          id: string
          note: string | null
          start_date: string
          status: string
          task_raw_id: string
          to_pic: string
          to_pic_norm: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          from_pic: string
          from_pic_norm?: string | null
          id?: string
          note?: string | null
          start_date: string
          status?: string
          task_raw_id: string
          to_pic: string
          to_pic_norm?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          from_pic?: string
          from_pic_norm?: string | null
          id?: string
          note?: string | null
          start_date?: string
          status?: string
          task_raw_id?: string
          to_pic?: string
          to_pic_norm?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tm_pic_delegations_task_raw_id_fkey"
            columns: ["task_raw_id"]
            isOneToOne: false
            referencedRelation: "task_management_raw"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tm_pic_delegations_task_raw_id_fkey"
            columns: ["task_raw_id"]
            isOneToOne: false
            referencedRelation: "v_task_management_raw_derived"
            referencedColumns: ["id"]
          },
        ]
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
      wrt_change_log: {
        Row: {
          action: string
          batch_id: string | null
          changed_at: string
          changed_by: string | null
          column_name: string | null
          id: string
          item_id: string | null
          new_value: string | null
          old_value: string | null
          row_id: string
          source: string
          stage_code: string | null
          table_name: string
          wrt_number: string | null
        }
        Insert: {
          action: string
          batch_id?: string | null
          changed_at?: string
          changed_by?: string | null
          column_name?: string | null
          id?: string
          item_id?: string | null
          new_value?: string | null
          old_value?: string | null
          row_id: string
          source?: string
          stage_code?: string | null
          table_name: string
          wrt_number?: string | null
        }
        Update: {
          action?: string
          batch_id?: string | null
          changed_at?: string
          changed_by?: string | null
          column_name?: string | null
          id?: string
          item_id?: string | null
          new_value?: string | null
          old_value?: string | null
          row_id?: string
          source?: string
          stage_code?: string | null
          table_name?: string
          wrt_number?: string | null
        }
        Relationships: []
      }
      wrt_import_logs: {
        Row: {
          cleared_values: number
          created_at: string
          file_name: string
          finished_at: string | null
          id: string
          imported_by: string | null
          items_updated: number
          matched: number
          note: string | null
          ocs_excluded: number
          sheet_names: string[]
          stages_upserted: number
          started_at: string
          status: string
          total_rows: number
          unmatched: number
          updated_at: string
        }
        Insert: {
          cleared_values?: number
          created_at?: string
          file_name: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          items_updated?: number
          matched?: number
          note?: string | null
          ocs_excluded?: number
          sheet_names?: string[]
          stages_upserted?: number
          started_at?: string
          status?: string
          total_rows?: number
          unmatched?: number
          updated_at?: string
        }
        Update: {
          cleared_values?: number
          created_at?: string
          file_name?: string
          finished_at?: string | null
          id?: string
          imported_by?: string | null
          items_updated?: number
          matched?: number
          note?: string | null
          ocs_excluded?: number
          sheet_names?: string[]
          stages_upserted?: number
          started_at?: string
          status?: string
          total_rows?: number
          unmatched?: number
          updated_at?: string
        }
        Relationships: []
      }
      wrt_import_row_logs: {
        Row: {
          batch_id: string
          changes: Json
          code: string | null
          created_at: string
          detail: string | null
          excel_row: number | null
          id: string
          outcome: string
          sheet_name: string | null
          wrt_number: string | null
        }
        Insert: {
          batch_id: string
          changes?: Json
          code?: string | null
          created_at?: string
          detail?: string | null
          excel_row?: number | null
          id?: string
          outcome: string
          sheet_name?: string | null
          wrt_number?: string | null
        }
        Update: {
          batch_id?: string
          changes?: Json
          code?: string | null
          created_at?: string
          detail?: string | null
          excel_row?: number | null
          id?: string
          outcome?: string
          sheet_name?: string | null
          wrt_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wrt_import_row_logs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "wrt_import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      wrt_items: {
        Row: {
          created_at: string
          created_by: string | null
          data_date: string | null
          dis: string | null
          eng: string | null
          exclusion_reason: string | null
          final_approved_raw: string | null
          id: string
          is_active: boolean
          is_excluded: boolean
          is_final_approved: boolean
          latest_response_code: string | null
          latest_status_raw: string | null
          owner_user_id: string | null
          pic: string | null
          plot: string
          r1_response_code: string | null
          r1_response_code_raw: string | null
          r2_response_code: string | null
          r2_response_code_raw: string | null
          response_source: string
          service: string | null
          source_file: string | null
          team: string | null
          title: string | null
          updated_at: string
          updated_by: string | null
          wrt_number: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data_date?: string | null
          dis?: string | null
          eng?: string | null
          exclusion_reason?: string | null
          final_approved_raw?: string | null
          id?: string
          is_active?: boolean
          is_excluded?: boolean
          is_final_approved?: boolean
          latest_response_code?: string | null
          latest_status_raw?: string | null
          owner_user_id?: string | null
          pic?: string | null
          plot: string
          r1_response_code?: string | null
          r1_response_code_raw?: string | null
          r2_response_code?: string | null
          r2_response_code_raw?: string | null
          response_source?: string
          service?: string | null
          source_file?: string | null
          team?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          wrt_number: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data_date?: string | null
          dis?: string | null
          eng?: string | null
          exclusion_reason?: string | null
          final_approved_raw?: string | null
          id?: string
          is_active?: boolean
          is_excluded?: boolean
          is_final_approved?: boolean
          latest_response_code?: string | null
          latest_status_raw?: string | null
          owner_user_id?: string | null
          pic?: string | null
          plot?: string
          r1_response_code?: string | null
          r1_response_code_raw?: string | null
          r2_response_code?: string | null
          r2_response_code_raw?: string | null
          response_source?: string
          service?: string | null
          source_file?: string | null
          team?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          wrt_number?: string
        }
        Relationships: []
      }
      wrt_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      wrt_stage_catalog: {
        Row: {
          actual_authority: string
          band: string
          chain_excluded: boolean
          created_at: string
          in_progress_denominator: boolean
          label: string
          module: string
          note: string | null
          round_no: number | null
          short_code: string
          sort_order: number
          stage_code: string
          updated_at: string
          value_type: string
        }
        Insert: {
          actual_authority?: string
          band: string
          chain_excluded?: boolean
          created_at?: string
          in_progress_denominator?: boolean
          label: string
          module?: string
          note?: string | null
          round_no?: number | null
          short_code: string
          sort_order: number
          stage_code: string
          updated_at?: string
          value_type: string
        }
        Update: {
          actual_authority?: string
          band?: string
          chain_excluded?: boolean
          created_at?: string
          in_progress_denominator?: boolean
          label?: string
          module?: string
          note?: string | null
          round_no?: number | null
          short_code?: string
          sort_order?: number
          stage_code?: string
          updated_at?: string
          value_type?: string
        }
        Relationships: []
      }
      wrt_stage_progress: {
        Row: {
          actual_estimated: boolean
          actual_finish: string | null
          actual_start: string | null
          backfill_batch_id: string | null
          created_at: string
          created_by: string | null
          data_date: string | null
          flag_value: string | null
          id: string
          item_id: string
          na_flag: boolean
          plan_finish: string | null
          plan_start: string | null
          remarks: string | null
          stage_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actual_estimated?: boolean
          actual_finish?: string | null
          actual_start?: string | null
          backfill_batch_id?: string | null
          created_at?: string
          created_by?: string | null
          data_date?: string | null
          flag_value?: string | null
          id?: string
          item_id: string
          na_flag?: boolean
          plan_finish?: string | null
          plan_start?: string | null
          remarks?: string | null
          stage_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actual_estimated?: boolean
          actual_finish?: string | null
          actual_start?: string | null
          backfill_batch_id?: string | null
          created_at?: string
          created_by?: string | null
          data_date?: string | null
          flag_value?: string | null
          id?: string
          item_id?: string
          na_flag?: boolean
          plan_finish?: string | null
          plan_start?: string | null
          remarks?: string | null
          stage_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wrt_stage_progress_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "wrt_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wrt_stage_progress_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "wrt_items_judged"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wrt_stage_progress_stage_code_fkey"
            columns: ["stage_code"]
            isOneToOne: false
            referencedRelation: "wrt_stage_catalog"
            referencedColumns: ["stage_code"]
          },
        ]
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
      spl_items_judged: {
        Row: {
          approval_status_raw: string | null
          created_at: string | null
          created_by: string | null
          data_date: string | null
          dis: string | null
          eng: string | null
          eng_po: string | null
          exclusion_reason: string | null
          id: string | null
          is_active: boolean | null
          is_excluded: boolean | null
          j_active_round: string | null
          j_bucket_top: string | null
          j_completed_stage: string | null
          j_current_stage: string | null
          judgment: Json | null
          latest_status: string | null
          latest_status_raw: string | null
          owner_user_id: string | null
          pic: string | null
          pic_po: string | null
          plot: string | null
          revision: string | null
          service: string | null
          source_file: string | null
          spl_number: string | null
          supplier: string | null
          team: string | null
          title: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Relationships: []
      }
      spl_precedence_violations: {
        Row: {
          actual_date: string | null
          detail: string | null
          item_id: string | null
          label: string | null
          missing_predecessors: number | null
          plot: string | null
          sort_order: number | null
          spl_number: string | null
          stage_code: string | null
          team: string | null
          violation_type: string | null
        }
        Relationships: []
      }
      v_task_management_raw_derived: {
        Row: {
          actual_duration: number | null
          actual_finish: string | null
          actual_overdue: string | null
          actual_progress: number | null
          actual_start: string | null
          alarm_reason: string | null
          auto_judgment: string | null
          auto_judgment_import: string | null
          category: string | null
          created_at: string | null
          cum_actual_pct: number | null
          cum_plan_pct: number | null
          data_date: string | null
          delay_days: number | null
          discipline: string | null
          expected_finish: string | null
          expected_progress_today: number | null
          floor_level: string | null
          forecast_end: string | null
          gap_pct: number | null
          hdec_eng_name: string | null
          hdec_pic_name: string | null
          id: string | null
          imported_at: string | null
          imported_by: string | null
          is_active: boolean | null
          is_rollup: boolean | null
          level: string | null
          location: string | null
          main_task_no: string | null
          milestone: string | null
          milestone_date: string | null
          owner_user_id: string | null
          plan_days: number | null
          plan_end: string | null
          plan_overdue: string | null
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
          stage_finish: string | null
          stage_start: string | null
          status_manual: string | null
          sub_task_desc: string | null
          task_name: string | null
          task_no: string | null
          team: string | null
          updated_at: string | null
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
      wrt_items_judged: {
        Row: {
          created_at: string | null
          created_by: string | null
          data_date: string | null
          dis: string | null
          eng: string | null
          exclusion_reason: string | null
          final_approved_raw: string | null
          id: string | null
          is_active: boolean | null
          is_excluded: boolean | null
          is_final_approved: boolean | null
          j_active_round: string | null
          j_bucket_top: string | null
          j_completed_stage: string | null
          j_current_stage: string | null
          judgment: Json | null
          latest_response_code: string | null
          latest_status_raw: string | null
          owner_user_id: string | null
          pic: string | null
          plot: string | null
          r1_response_code: string | null
          r1_response_code_raw: string | null
          r2_response_code: string | null
          r2_response_code_raw: string | null
          response_source: string | null
          service: string | null
          source_file: string | null
          team: string | null
          title: string | null
          updated_at: string | null
          updated_by: string | null
          wrt_number: string | null
        }
        Relationships: []
      }
      wrt_precedence_violations: {
        Row: {
          actual_date: string | null
          detail: string | null
          item_id: string | null
          label: string | null
          missing_predecessors: number | null
          plot: string | null
          sort_order: number | null
          stage_code: string | null
          team: string | null
          violation_type: string | null
          wrt_number: string | null
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
      _snag_done_asof: {
        Args: {
          _acd: string
          _add?: string
          _ahd?: string
          _apd?: string
          _as_of: string
          _asd: string
          _axd: string
          _pnorm: number
          _sr: string
          _stage: string
        }
        Returns: boolean
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
      abd_allowed_cols: { Args: never; Returns: string[] }
      abd_approved_round: {
        Args: { _row: Database["public"]["Tables"]["abd_items_raw"]["Row"] }
        Returns: number
      }
      abd_audit_risk_reasons: {
        Args: { r: Database["public"]["Tables"]["abd_items_raw"]["Row"] }
        Returns: string[]
      }
      abd_backfill_response_results: {
        Args: { _dry_run?: boolean }
        Returns: {
          abd_number: string
          item_id: string
          last_round: number
          r1_set: string
          r2_set: string
          r3_set: string
        }[]
      }
      abd_bucket_of: {
        Args: { _bucket_top: string; _is_active: boolean }
        Returns: string
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
      abd_dashboard_attention_lists: {
        Args: {
          _as_of?: string
          _batch_no?: string[]
          _limit?: number
          _plots?: string[]
          _teams?: string[]
        }
        Returns: Json
      }
      abd_dashboard_crosscut: {
        Args: {
          _as_of?: string
          _batch_no?: string[]
          _plots?: string[]
          _teams?: string[]
        }
        Returns: {
          bucket: string
          cnt: number
          dis: string
          service: string
        }[]
      }
      abd_dashboard_judgment_mix: {
        Args: { _as_of?: string; _batch_no?: string[]; _plots?: string[] }
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
      abd_dashboard_row1: {
        Args: { _batch_no?: string[]; _plots?: string[]; _teams?: string[] }
        Returns: {
          bucket: string
          cnt: number
          team: string
        }[]
      }
      abd_dashboard_row1_json: {
        Args: {
          _as_of?: string
          _batch_no?: string[]
          _plots?: string[]
          _teams?: string[]
        }
        Returns: Json
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
      abd_dashboard_row2_json: {
        Args: {
          _as_of?: string
          _batch_no?: string[]
          _plots?: string[]
          _teams?: string[]
        }
        Returns: Json
      }
      abd_dashboard_status_dist: {
        Args: {
          _as_of?: string
          _batch_no?: string[]
          _plots?: string[]
          _teams?: string[]
        }
        Returns: {
          cnt: number
          status: string
        }[]
      }
      abd_derived_cols: { Args: never; Returns: string[] }
      abd_items_by_numbers: { Args: { _nums: string[] }; Returns: Json }
      abd_items_counts: {
        Args: { _as_of?: string; _plot?: string; _team?: string }
        Returns: {
          approved_count: number
          cancelled_count: number
          ds_count: number
          latest_data_date: string
          resubmit_count: number
          total_count: number
          ur_count: number
        }[]
      }
      abd_items_facets: {
        Args: {
          _as_of?: string
          _column: string
          _filters?: Json
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
          _as_of?: string
          _bucket?: string[]
          _filters?: Json
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
        Returns: Json
      }
      abd_judge_v1: {
        Args: {
          _as_of?: string
          _row: Database["public"]["Tables"]["abd_items_raw"]["Row"]
        }
        Returns: Json
      }
      abd_mask_future_actuals: {
        Args: {
          _as_of: string
          _row: Database["public"]["Tables"]["abd_items_raw"]["Row"]
        }
        Returns: Json
      }
      abd_mf_ready: {
        Args: { r: Database["public"]["Tables"]["abd_items_raw"]["Row"] }
        Returns: boolean
      }
      abd_my_workspace_counts: {
        Args: { _filter_value: string; _mode: string; _today: string }
        Returns: Json
      }
      abd_my_workspace_rows: {
        Args: {
          _bucket: string
          _filter_value: string
          _limit?: number
          _mode: string
          _offset?: number
          _today: string
        }
        Returns: Json
      }
      abd_ocs_assert_admin: { Args: never; Returns: undefined }
      abd_ocs_baseline_core_hash: { Args: never; Returns: Json }
      abd_ocs_baseline_dump: {
        Args: { p_dataset: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      abd_ocs_can_manage: { Args: { _uid?: string }; Returns: boolean }
      abd_ocs_comment_visible: {
        Args: { _comment_id: string }
        Returns: boolean
      }
      abd_ocs_comments_for_item: {
        Args: { p_abd_item_id: string }
        Returns: Json
      }
      abd_ocs_dryrun_batch: { Args: { p_rows: Json }; Returns: Json }
      abd_ocs_finalize_comments: {
        Args: { p_source_ids: string[] }
        Returns: Json
      }
      abd_ocs_import_attachments: { Args: { p_rows: Json }; Returns: Json }
      abd_ocs_import_comments: {
        Args: { p_import_log_id: string; p_rows: Json }
        Returns: Json
      }
      abd_ocs_inc_attachment_stats: { Args: { p_run: string }; Returns: Json }
      abd_ocs_inc_baseline: {
        Args: { p_base_import_run_id?: string }
        Returns: Json
      }
      abd_ocs_inc_dryrun: {
        Args: { p_run: string; p_source_files?: Json }
        Returns: Json
      }
      abd_ocs_inc_import: {
        Args: {
          p_allow_retire?: boolean
          p_image_meta?: Json
          p_import_log_id: string
          p_run: string
          p_source_files?: Json
          p_source_meta?: Json
        }
        Returns: Json
      }
      abd_ocs_inc_import_core: {
        Args: {
          p_allow_retire?: boolean
          p_import_log_id: string
          p_run: string
          p_source_files?: Json
        }
        Returns: Json
      }
      abd_ocs_inc_outside_hash: { Args: { p_run: string }; Returns: Json }
      abd_ocs_inc_register_images: {
        Args: { p_image_meta: Json; p_run: string }
        Returns: Json
      }
      abd_ocs_inc_scope: {
        Args: { p_run: string }
        Returns: {
          ocs_norm: string
        }[]
      }
      abd_ocs_norm: { Args: { v: string }; Returns: string }
      abd_ocs_recount_all: { Args: never; Returns: Json }
      abd_ocs_recount_item: { Args: { p_item_id: string }; Returns: undefined }
      abd_ocs_recover_20260809: {
        Args: { p_recovery_log_id: string; p_snapshot_id: string }
        Returns: Json
      }
      abd_ocs_recover_20260809_dryrun: { Args: never; Returns: Json }
      abd_ocs_recover_20260809_precheck: { Args: never; Returns: Json }
      abd_ocs_set_complied: {
        Args: { p_comment_id: string; p_complied: boolean; p_expected: boolean }
        Returns: Json
      }
      abd_ocs_source_file_for_comment: {
        Args: { _comment_id: string }
        Returns: Json
      }
      abd_ocs_v2_dryrun_attachments: {
        Args: { p_ids: string[] }
        Returns: Json
      }
      abd_ocs_v2_dryrun_comments: { Args: { p_rows: Json }; Returns: Json }
      abd_ocs_v2_finalize_parents: {
        Args: { p_import_log_id: string }
        Returns: Json
      }
      abd_ocs_v2_import_comments: {
        Args: { p_import_log_id: string; p_rows: Json }
        Returns: Json
      }
      abd_ocs_v2_import_groups: {
        Args: { p_import_log_id: string; p_rows: Json }
        Returns: Json
      }
      abd_ocs_v2_import_links: {
        Args: { p_import_log_id: string; p_rows: Json }
        Returns: Json
      }
      abd_ocs_v2_verify: { Args: never; Returns: Json }
      abd_ocs_v3_attachment_metrics: { Args: never; Returns: Json }
      abd_ocs_v3_dryrun: { Args: { p_run: string }; Returns: Json }
      abd_ocs_v3_dryrun_parents: { Args: { p_rows: Json }; Returns: Json }
      abd_ocs_v3_import: {
        Args: { p_import_log_id: string; p_run: string }
        Returns: Json
      }
      abd_ocs_v3_stage_load_attachments: {
        Args: { p_rows: Json; p_run: string }
        Returns: Json
      }
      abd_ocs_v3_stage_load_comments: {
        Args: { p_rows: Json; p_run: string }
        Returns: Json
      }
      abd_ocs_v3_stage_load_groups: {
        Args: { p_rows: Json; p_run: string }
        Returns: Json
      }
      abd_ocs_v3_stage_load_response: {
        Args: { p_rows: Json; p_run: string }
        Returns: Json
      }
      abd_ocs_v3_stage_reset: { Args: { p_run: string }; Returns: Json }
      abd_ocs_v3_verify: { Args: never; Returns: Json }
      abd_ocs_v3_verify_internal: { Args: never; Returns: Json }
      abd_ocs_verify: { Args: never; Returns: Json }
      abd_progress_cell_ids: {
        Args: {
          _as_of?: string
          _field: string
          _from: string
          _plan_mode?: string
          _stage: string
          _to: string
        }
        Returns: {
          item_id: string
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
      abd_progress_cells_json: {
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
        Returns: Json
      }
      abd_progress_cum_json: {
        Args: {
          _as_of_date: string
          _bucket: string
          _plan_mode: string
          _plots: string[]
          _range_end: string
          _range_start: string
          _round: string
          _teams: string[]
        }
        Returns: Json
      }
      abd_progress_events: {
        Args: { _as_of_date: string; _plan_mode?: string; _round?: string }
        Returns: {
          edate: string
          field: string
          item_id: string
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
      abd_progress_totals_json: {
        Args: {
          _as_of_date: string
          _group_by: string[]
          _plan_mode: string
          _plots: string[]
          _round: string
          _teams: string[]
        }
        Returns: Json
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
      abd_rows_as_of: {
        Args: { _as_of?: string }
        Returns: {
          abd_number: string
          abd_ocs_no: string | null
          aconex_date_modified: string | null
          aconex_last_synced_at: string | null
          aconex_review_status_raw: string | null
          aconex_status_raw: string | null
          active_round: number | null
          approval_date: string | null
          audit_at: string | null
          audit_by: string | null
          audit_note: string | null
          audit_reason: string | null
          audit_selected_at: string | null
          audit_status: string
          batch_no: string | null
          bucket_top: string | null
          completed_stage: string | null
          completed_stage_group: string | null
          created_at: string
          current_stage: string | null
          data_date: string | null
          delay_bucket: string[]
          delay_late: string[]
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
          is_reopened: boolean
          is_terminated: boolean
          latest_rev: string | null
          latest_status: string | null
          latest_status_norm: string | null
          mf_changed_after_ds: boolean
          mf_check: boolean
          mf_checked_at: string | null
          mf_checked_by: string | null
          mf_reference: string | null
          mf_revision: string | null
          mf_types: string[]
          mismatch_fields: Json
          needs_planning: boolean
          needs_revise: boolean
          ocs_check: string
          ocs_complied: number
          ocs_total: number
          owner_user_id: string | null
          plot: string | null
          primary_delay: string | null
          r1_dar_actual: string | null
          r1_dar_plan: string | null
          r1_draft_finish_actual: string | null
          r1_draft_finish_plan: string | null
          r1_draft_start_actual: string | null
          r1_draft_start_plan: string | null
          r1_response_result: string | null
          r1_response_source: string | null
          r1_submission_actual: string | null
          r1_submission_plan: string | null
          r2_dar_actual: string | null
          r2_dar_plan: string | null
          r2_draft_finish_actual: string | null
          r2_draft_finish_plan: string | null
          r2_draft_start_actual: string | null
          r2_draft_start_plan: string | null
          r2_response_result: string | null
          r2_response_source: string | null
          r2_submission_actual: string | null
          r2_submission_plan: string | null
          r3_dar_actual: string | null
          r3_dar_plan: string | null
          r3_draft_finish_actual: string | null
          r3_draft_finish_plan: string | null
          r3_draft_start_actual: string | null
          r3_draft_start_plan: string | null
          r3_response_result: string | null
          r3_response_source: string | null
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
        }[]
        SetofOptions: {
          from: "*"
          to: "abd_items_raw"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      abd_stage_group: {
        Args: { _row: Database["public"]["Tables"]["abd_items_raw"]["Row"] }
        Returns: string
      }
      abd_stage_group_counts: {
        Args: {
          _as_of?: string
          _batch_no?: string[]
          _plots?: string[]
          _teams?: string[]
        }
        Returns: Json
      }
      abd_team_list: {
        Args: never
        Returns: {
          cnt: number
          team: string
        }[]
      }
      allocate_main_task_no: { Args: { _discipline: string }; Returns: string }
      allocate_task_no: {
        Args: { _discipline: string; _main_task_no: string }
        Returns: string
      }
      backup_claim_run: {
        Args: { _metadata?: Json; _run_id: string }
        Returns: Json
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
      defect_items_facets: {
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
        Returns: Json
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
      defect_snag_dashboard_matrix_json: {
        Args: {
          _as_of_date?: string
          _plan_groups?: string[]
          _teams?: string[]
        }
        Returns: Json
      }
      defect_snag_ho_dates_json: {
        Args: {
          _as_of_date?: string
          _plan_groups?: string[]
          _teams?: string[]
        }
        Returns: Json
      }
      defect_snag_progress_cells: {
        Args: {
          _as_of_date: string
          _bucket: string
          _buildings?: string[]
          _group_by: string[]
          _include_agg?: boolean
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
      defect_snag_progress_cells_json: {
        Args: {
          _as_of_date: string
          _bucket: string
          _buildings?: string[]
          _group_by: string[]
          _include_agg?: boolean
          _plan_groups: string[]
          _plan_mode: string
          _range_end: string
          _range_start: string
          _room_groups: string[]
          _teams: string[]
        }
        Returns: Json
      }
      defect_snag_progress_cum_json: {
        Args: {
          _as_of_date: string
          _bucket: string
          _buildings: string[]
          _plan_groups: string[]
          _plan_mode: string
          _range_end: string
          _range_start: string
          _room_groups: string[]
          _teams: string[]
        }
        Returns: Json
      }
      defect_snag_progress_totals: {
        Args: {
          _as_of_date: string
          _buildings?: string[]
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
          no_plan: number
          np_mask: Json
          plan_upto: number
          stage: string
          total: number
        }[]
      }
      defect_snag_progress_totals_json: {
        Args: {
          _as_of_date: string
          _buildings?: string[]
          _group_by: string[]
          _plan_groups: string[]
          _plan_mode: string
          _room_groups: string[]
          _teams: string[]
        }
        Returns: Json
      }
      defect_snag_stage_dates_json: {
        Args: {
          _as_of_date?: string
          _plan_groups?: string[]
          _teams?: string[]
        }
        Returns: Json
      }
      delete_abd_import_batch: { Args: { _batch_id: string }; Returns: Json }
      delete_defect_import_batch: { Args: { _batch_id: string }; Returns: Json }
      delete_task_management_import_batch: {
        Args: { _batch_id: string }
        Returns: Json
      }
      dmr_facets: {
        Args: { _column: string; _filters?: Json; _q?: string; _scope?: string }
        Returns: {
          cnt: number
          value: string
        }[]
      }
      get_backup_tables: { Args: never; Returns: string[] }
      get_module_backup_tables: { Args: { _module: string }; Returns: string[] }
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
      hdec_assert_admin: { Args: never; Returns: undefined }
      hdec_canonical_map: { Args: { _kind: string }; Returns: Json }
      hdec_master_table: { Args: { _kind: string }; Returns: string }
      hdec_name_norm: { Args: { _name: string }; Returns: string }
      hdec_name_usage: {
        Args: { _kind: string }
        Returns: {
          cnt: number
          module: string
          norm: string
        }[]
      }
      hdec_people_list: {
        Args: { _include_orphans?: boolean; _kind: string }
        Returns: Json
      }
      hdec_recalc_owner_for_user: {
        Args: { _reason?: string; _user_id: string }
        Returns: Json
      }
      hdec_registry_backfill: { Args: { _kind: string }; Returns: Json }
      hdec_registry_upsert: {
        Args: { _kind: string; _names: string[] }
        Returns: Json
      }
      hdec_roster_list: { Args: { _kind: string }; Returns: Json }
      hdec_roster_merge: {
        Args: { _dst_id: string; _kind: string; _src_id: string }
        Returns: Json
      }
      hdec_roster_rename_preview: {
        Args: { _id: string; _kind: string }
        Returns: Json
      }
      hdec_roster_update: {
        Args: {
          _clear_link?: boolean
          _id: string
          _is_active?: boolean
          _kind: string
          _linked_user_id?: string
          _name?: string
          _note?: string
          _variants?: string[]
          _verified?: boolean
        }
        Returns: Json
      }
      is_admin_or_super: { Args: { _user_id: string }; Returns: boolean }
      is_full_access: { Args: { _user_id: string }; Returns: boolean }
      is_qaqc_readonly: { Args: { _user_id: string }; Returns: boolean }
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
      is_system_admin: { Args: { _user_id?: string }; Returns: boolean }
      plot_module_team_last_date: {
        Args: never
        Returns: {
          label: string
          last_date: string
          plot: string
        }[]
      }
      preview_rollback_abd_import: {
        Args: { _batch_id: string }
        Returns: Json
      }
      preview_rollback_defect_import: {
        Args: { _batch_id: string }
        Returns: Json
      }
      preview_rollback_task_management_import: {
        Args: { _batch_id: string }
        Returns: Json
      }
      rcl_bulk_role_apply: { Args: { _items: Json }; Returns: Json }
      rcl_bulk_role_preview: { Args: { _items: Json }; Returns: Json }
      rcl_can: {
        Args: {
          _action: string
          _module: string
          _row_id: string
          _user_id: string
        }
        Returns: boolean
      }
      rcl_can_rows: {
        Args: { _action: string; _module: string; _row_ids: string[] }
        Returns: Json
      }
      rcl_can_values: {
        Args: { _action: string; _module: string; _values: Json }
        Returns: boolean
      }
      rcl_grants: { Args: { _action: string; _module: string }; Returns: Json }
      rcl_grants_for: {
        Args: { _action: string; _module: string; _user_id: string }
        Returns: Json
      }
      rcl_grants_impl: {
        Args: { _action: string; _module: string; _user_id: string }
        Returns: Json
      }
      rcl_highest_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      rcl_import_filter: {
        Args: { _match_cols: string[]; _module: string; _rows: Json }
        Returns: Json
      }
      rcl_max_scope: {
        Args: { _action: string; _module: string; _user_id: string }
        Returns: string
      }
      rcl_module_of_table: { Args: { _table_name: string }; Returns: string }
      rcl_role_counts: {
        Args: never
        Returns: {
          cnt: number
          role: string
        }[]
      }
      rcl_scope: {
        Args: { _module: string; _row_id: string; _user_id: string }
        Returns: string
      }
      rcl_scope_core: {
        Args: { _module: string; _row: Json; _user_id: string }
        Returns: string
      }
      rcl_scope_of_values: {
        Args: { _module: string; _user_id: string; _values: Json }
        Returns: string
      }
      rcl_set_module_owning_team: {
        Args: { _module: string; _team: string }
        Returns: Json
      }
      rcl_team_user_counts: {
        Args: never
        Returns: {
          cnt: number
          team: string
        }[]
      }
      recalc_task_auto_judgment: {
        Args: { _discipline?: string }
        Returns: number
      }
      recalc_task_progress_charts: {
        Args: { _discipline?: string; _task_no?: string }
        Returns: number
      }
      resolve_login_email: { Args: { _login_id: string }; Returns: string }
      resolve_owner_by_name: { Args: { _name: string }; Returns: string }
      resolve_user_by_name: { Args: { _name: string }; Returns: string }
      rollback_abd_import: {
        Args: { _batch_id: string; _force?: boolean }
        Returns: Json
      }
      rollback_defect_import: {
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
      snag_progress_cell_ids: {
        Args: {
          _as_of?: string
          _field: string
          _from: string
          _plan_mode?: string
          _stage: string
          _to: string
        }
        Returns: {
          item_id: string
        }[]
      }
      snag_progress_events:
        | {
            Args: { _as_of_date: string; _plan_mode?: string }
            Returns: {
              edate: string
              field: string
              item_id: string
              stage: string
            }[]
          }
        | {
            Args: {
              _as_of_date: string
              _buildings?: string[]
              _plan_groups?: string[]
              _plan_mode: string
              _range_end: string
              _range_start: string
              _room_groups?: string[]
              _teams?: string[]
            }
            Returns: {
              edate: string
              field: string
              item_id: string
              stage: string
            }[]
          }
      spl_aconex_apply: {
        Args: { _batch_id: string; _patches: Json }
        Returns: Json
      }
      spl_active_round: {
        Args: { _as_of?: string }
        Returns: {
          active_round: number
          item_id: string
        }[]
      }
      spl_assert_row_rules: { Args: { _item_id: string }; Returns: undefined }
      spl_document_pages_search: {
        Args: {
          _document_id?: string
          _limit?: number
          _q: string
          _spl_item_id?: string
        }
        Returns: Json
      }
      spl_estimated_cells: { Args: never; Returns: Json }
      spl_eval_as_of: {
        Args: { _as_of?: string }
        Returns: {
          active_band: string
          active_band_state: string
          as_of: string
          band_states: Json
          completed_stage: Json
          current_stage: Json
          delay_bucket: Json
          delayed: number
          denom: number
          done: number
          has_plan: boolean
          hdec_actual_count: number
          item_id: string
          judgment: string
          na_count: number
          primary_delay: Json
          req_doc_done: number
          req_doc_total: number
          stages: Json
        }[]
      }
      spl_hdec_apply: {
        Args: {
          _allow_deletes?: boolean
          _batch_id: string
          _delete_count?: number
          _patches: Json
        }
        Returns: Json
      }
      spl_judge_one: {
        Args: { _as_of?: string; _item_id: string }
        Returns: Json
      }
      spl_judge_v1: {
        Args: { _as_of?: string }
        Returns: {
          item_id: string
          judgment: Json
        }[]
      }
      spl_ocs_can_manage: { Args: never; Returns: boolean }
      spl_ocs_can_write_comment: {
        Args: { _comment_id: string }
        Returns: boolean
      }
      spl_ocs_comments_for_spl: {
        Args: { _spl_item_id: string }
        Returns: Json
      }
      spl_ocs_deactivate_comment: {
        Args: { _id: string; _reason: string }
        Returns: Json
      }
      spl_ocs_log: {
        Args: {
          _action: string
          _column: string
          _item_id: string
          _new: string
          _old: string
          _row_id: string
          _table: string
        }
        Returns: undefined
      }
      spl_ocs_recount_all: { Args: never; Returns: Json }
      spl_ocs_recount_all_internal: { Args: never; Returns: Json }
      spl_ocs_set_category: {
        Args: { _category_id: string; _comment_id: string; _on: boolean }
        Returns: Json
      }
      spl_ocs_set_complied: {
        Args: { _comment_id: string; _complied: boolean; _expected: boolean }
        Returns: Json
      }
      spl_ocs_set_rsp_link: {
        Args: { _comment_id: string; _on: boolean; _rsp_item_id: string }
        Returns: Json
      }
      spl_ocs_set_spl_link: {
        Args: { _comment_id: string; _on: boolean; _spl_item_id: string }
        Returns: Json
      }
      spl_ocs_upsert_category: {
        Args: {
          _code: string
          _id: string
          _is_active: boolean
          _label: string
        }
        Returns: Json
      }
      spl_ocs_upsert_comment: {
        Args: {
          _assessed_code: string
          _comment_text: string
          _contractor_response: string
          _id: string
          _ocs_number: string
          _revision: string
          _sign_off_status: string
          _spl_item_id: string
        }
        Returns: Json
      }
      spl_ocs_v1_import: {
        Args: { p_dry_run?: boolean; p_snapshot_id?: string }
        Returns: Json
      }
      spl_ocs_verify: { Args: never; Returns: Json }
      spl_ocs_verify_internal: { Args: never; Returns: Json }
      spl_precheck_patches: { Args: { _patches: Json }; Returns: Json }
      spl_rows_as_of: { Args: { _as_of?: string }; Returns: Json }
      spl_rsp_deactivate: {
        Args: { _id: string; _reason: string }
        Returns: Json
      }
      spl_rsp_for_spl: { Args: { _spl_item_id: string }; Returns: Json }
      spl_rsp_upsert: {
        Args: {
          _description: string
          _id: string
          _manufacturer: string
          _model: string
          _qty_available: number
          _qty_required: number
          _qty_short: number
          _spl_item_id: string
          _unit: string
        }
        Returns: Json
      }
      spl_rule_msg: {
        Args: {
          _missing: string[]
          _num: string
          _ready: number
          _total: number
        }
        Returns: string
      }
      spl_stage_state: {
        Args: {
          _actual_finish: string
          _actual_start: string
          _as_of: string
          _flag: string
          _na: boolean
          _plan_finish: string
          _plan_start: string
          _value_type: string
        }
        Returns: string
      }
      tm_actual_at_set: {
        Args: { _as_of: string; _ids?: string[] }
        Returns: {
          a_asof: number
          a_prev: number
          b_asof: number
          b_prev: number
          task_raw_id: string
        }[]
      }
      tm_classify_overdue: {
        Args: { buffer_days: number; mstone: string; target: string }
        Returns: string
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
      tm_cum_actual_at: {
        Args: { _d: string; _fallback: number; _task_raw_id: string }
        Returns: number
      }
      tm_edit_record_daily: {
        Args: { p_from: string; p_to: string }
        Returns: {
          date_key: string
          user_id: string
        }[]
      }
      tm_effective_pic: {
        Args: { _as_of?: string; _task_raw_id: string }
        Returns: string
      }
      tm_effective_pic_map: {
        Args: { _as_of?: string; _discipline: string; _task_nos: string[] }
        Returns: Json
      }
      tm_expected_finish: {
        Args: {
          actual_finish: string
          actual_progress: number
          actual_start: string
          data_date: string
        }
        Returns: string
      }
      tm_is_delegate: {
        Args: { _as_of?: string; _task_raw_id: string; _user_id: string }
        Returns: boolean
      }
      tm_items_counts: {
        Args: {
          _as_of?: string
          _caution_buffer?: number
          _filters?: Json
          _include_inactive?: boolean
          _q?: string
          _task_scope?: string
          _worsen_gap?: number
        }
        Returns: Json
      }
      tm_items_counts_by_bucket: {
        Args: {
          _as_of?: string
          _filters?: Json
          _include_inactive?: boolean
          _q?: string
          _thresholds?: Json
        }
        Returns: Json
      }
      tm_items_counts_by_bucket_by_team: {
        Args: {
          _as_of?: string
          _filters?: Json
          _include_inactive?: boolean
          _q?: string
          _thresholds?: Json
        }
        Returns: Json
      }
      tm_items_counts_by_team: {
        Args: {
          _as_of?: string
          _caution_buffer?: number
          _filters?: Json
          _include_inactive?: boolean
          _q?: string
          _task_scope?: string
          _worsen_gap?: number
        }
        Returns: Json
      }
      tm_items_facets: {
        Args: {
          _as_of?: string
          _columns: string[]
          _filters?: Json
          _include_inactive?: boolean
          _kpi_mode?: string
          _q?: string
          _thresholds?: Json
        }
        Returns: {
          axis: string
          cnt: number
          value: string
        }[]
      }
      tm_items_kpi_bundle: {
        Args: {
          _as_of?: string
          _caution_buffer?: number
          _filters?: Json
          _include_inactive?: boolean
          _q?: string
          _task_scope?: string
          _worsen_gap?: number
        }
        Returns: Json
      }
      tm_items_search: {
        Args: {
          _as_of?: string
          _filters?: Json
          _ids?: string[]
          _include_inactive?: boolean
          _kpi_mode?: string
          _limit?: number
          _offset?: number
          _q?: string
          _sort?: Json
          _thresholds?: Json
        }
        Returns: Json
      }
      tm_items_search_ids: {
        Args: {
          _as_of?: string
          _filters?: Json
          _include_inactive?: boolean
          _kpi_mode?: string
          _limit?: number
          _q?: string
          _thresholds?: Json
        }
        Returns: Json
      }
      tm_items_weighted_progress: {
        Args: {
          _as_of?: string
          _filters?: Json
          _include_inactive?: boolean
          _q?: string
        }
        Returns: Json
      }
      tm_kpi_bucket_matches: {
        Args: {
          _actual_finish: string
          _actual_progress: number
          _actual_start: string
          _as_of: string
          _bucket: string
          _caution_buffer: number
          _plan_days: number
          _plan_end: string
          _plan_progress: number
          _plan_start: string
          _worsen_gap: number
        }
        Returns: boolean
      }
      tm_kpi_bucket_matches_g: {
        Args: {
          _actual_finish: string
          _actual_progress: number
          _actual_start: string
          _as_of: string
          _bucket: string
          _caution_buffer?: number
          _gap: number
          _plan_end: string
          _plan_start: string
          _worsen_gap?: number
        }
        Returns: boolean
      }
      tm_kpi_cum_plan: {
        Args: {
          _as_of: string
          _plan_days: number
          _plan_end: string
          _plan_progress: number
          _plan_start: string
        }
        Returns: number
      }
      tm_kpi_gap: {
        Args: {
          _actual_progress: number
          _as_of: string
          _plan_days: number
          _plan_end: string
          _plan_progress: number
          _plan_start: string
        }
        Returns: number
      }
      tm_kpi_judgment: {
        Args: {
          _actual_finish: string
          _actual_progress: number
          _actual_start: string
          _as_of: string
          _caution_buffer: number
          _plan_days: number
          _plan_end: string
          _plan_progress: number
          _plan_start: string
          _worsen_gap: number
        }
        Returns: string
      }
      tm_kpi_judgment_g: {
        Args: {
          _actual_finish: string
          _actual_progress: number
          _actual_start: string
          _as_of: string
          _caution_buffer?: number
          _gap: number
          _plan_start: string
          _worsen_gap?: number
        }
        Returns: string
      }
      tm_kpi_norm_actual: { Args: { _v: number }; Returns: number }
      tm_kpi_tplan: {
        Args: {
          _as_of: string
          _plan_days: number
          _plan_end: string
          _plan_start: string
        }
        Returns: number
      }
      tm_main_tplan: {
        Args: { _as_of: string; _discipline: string; _task_no: string }
        Returns: number
      }
      tm_milestone_overdue_counts: {
        Args: {
          _filters?: Json
          _include_inactive?: boolean
          _q?: string
          _task_scope?: string
        }
        Returns: Json
      }
      tm_my_workspace_counts: {
        Args: { _filter_value: string; _mode: string; _today: string }
        Returns: Json
      }
      tm_my_workspace_rows: {
        Args: {
          _bucket: string
          _filter_value: string
          _limit?: number
          _mode: string
          _offset?: number
          _today: string
        }
        Returns: Json
      }
      tm_norm_progress: { Args: { p: number }; Returns: number }
      tm_resolve_caution: { Args: { _v: number }; Returns: number }
      tm_resolve_worsen: { Args: { _v: number }; Returns: number }
      tm_row_gap: {
        Args: {
          _actual_progress: number
          _as_of: string
          _discipline: string
          _level: string
          _plan_days: number
          _plan_end: string
          _plan_start: string
          _task_no: string
        }
        Returns: number
      }
      tm_row_tplan: {
        Args: {
          _as_of: string
          _discipline: string
          _level: string
          _plan_days: number
          _plan_end: string
          _plan_start: string
          _task_no: string
        }
        Returns: number
      }
      tm_rows_as_of: {
        Args: { _as_of: string }
        Returns: {
          actual_duration: number
          actual_finish: string
          actual_overdue: string
          actual_progress: number
          actual_start: string
          alarm_reason: string
          auto_judgment: string
          auto_judgment_import: string
          category: string
          created_at: string
          cum_actual_pct: number
          cum_plan_pct: number
          data_date: string
          delay_days: number
          delegated_from: string
          discipline: string
          effective_pic: string
          expected_finish: string
          expected_progress_today: number
          floor_level: string
          forecast_end: string
          gap_pct: number
          hdec_eng_name: string
          hdec_pic_name: string
          id: string
          imported_at: string
          imported_by: string
          is_active: boolean
          is_delegated: boolean
          is_rollup: boolean
          level: string
          location: string
          main_task_no: string
          milestone: string
          milestone_date: string
          original_pic: string
          owner_user_id: string
          plan_days: number
          plan_end: string
          plan_overdue: string
          plan_progress: number
          plan_start: string
          plot: string
          progress_variance: number
          risk: string
          row_type: string
          slip_days: number
          sort_order: number
          source_file: string
          source_import_log_id: string
          stage_finish: string
          stage_start: string
          status_manual: string
          sub_task_desc: string
          task_name: string
          task_no: string
          tc_actual_pct: number
          tc_plan_pct: number
          team: string
          updated_at: string
        }[]
      }
      tm_rows_as_of_json: { Args: { p_as_of?: string }; Returns: Json }
      tm_rows_as_of_notc: {
        Args: { _as_of: string }
        Returns: {
          actual_duration: number
          actual_finish: string
          actual_overdue: string
          actual_progress: number
          actual_start: string
          alarm_reason: string
          auto_judgment: string
          auto_judgment_import: string
          category: string
          created_at: string
          cum_actual_pct: number
          cum_plan_pct: number
          data_date: string
          delay_days: number
          delegated_from: string
          discipline: string
          effective_pic: string
          expected_finish: string
          expected_progress_today: number
          floor_level: string
          forecast_end: string
          gap_pct: number
          hdec_eng_name: string
          hdec_pic_name: string
          id: string
          imported_at: string
          imported_by: string
          is_active: boolean
          is_delegated: boolean
          is_rollup: boolean
          level: string
          location: string
          main_task_no: string
          milestone: string
          milestone_date: string
          original_pic: string
          owner_user_id: string
          plan_days: number
          plan_end: string
          plan_overdue: string
          plan_progress: number
          plan_start: string
          plot: string
          progress_variance: number
          risk: string
          row_type: string
          slip_days: number
          sort_order: number
          source_file: string
          source_import_log_id: string
          stage_finish: string
          stage_start: string
          status_manual: string
          sub_task_desc: string
          task_name: string
          task_no: string
          team: string
          updated_at: string
        }[]
      }
      tm_thresholds: { Args: never; Returns: Json }
      tm_today_actual: {
        Args: { _as_of: string; _ids: string[] }
        Returns: Json
      }
      tm_worktype_incomplete_counts: {
        Args: {
          _as_of?: string
          _filters?: Json
          _include_inactive?: boolean
          _q?: string
        }
        Returns: Json
      }
      update_task_summary: {
        Args: { _discipline: string; _parent_task_no: string }
        Returns: undefined
      }
      wrt_aconex_apply: {
        Args: { _batch_id: string; _patches: Json }
        Returns: Json
      }
      wrt_active_round: {
        Args: { _as_of?: string }
        Returns: {
          active_round: number
          item_id: string
        }[]
      }
      wrt_assert_row_rules: { Args: { _item_id: string }; Returns: undefined }
      wrt_estimated_cells: { Args: never; Returns: Json }
      wrt_eval_as_of: {
        Args: { _as_of?: string }
        Returns: {
          active_band: string
          active_band_state: string
          as_of: string
          band_states: Json
          completed_stage: Json
          current_stage: Json
          delay_bucket: Json
          delayed: number
          denom: number
          done: number
          has_plan: boolean
          hdec_actual_count: number
          item_id: string
          judgment: string
          na_count: number
          primary_delay: Json
          response_wait: Json
          stages: Json
        }[]
      }
      wrt_hdec_apply: {
        Args: {
          _allow_deletes?: boolean
          _batch_id: string
          _delete_count?: number
          _patches: Json
        }
        Returns: Json
      }
      wrt_judge_one: {
        Args: { _as_of?: string; _item_id: string }
        Returns: Json
      }
      wrt_judge_v1: {
        Args: { _as_of?: string }
        Returns: {
          item_id: string
          judgment: Json
        }[]
      }
      wrt_precheck_patches: { Args: { _patches: Json }; Returns: Json }
      wrt_rows_as_of: { Args: { _as_of?: string }; Returns: Json }
      wrt_rule_msg: { Args: { _code: string; _num: string }; Returns: string }
      wrt_stage_state: {
        Args: {
          _actual_finish: string
          _actual_start: string
          _as_of: string
          _flag: string
          _na: boolean
          _plan_finish: string
          _plan_start: string
          _value_type: string
        }
        Returns: string
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
        | "system_administrator"
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
        "system_administrator",
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
