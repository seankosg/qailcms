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
      defect_field_config: {
        Row: {
          created_at: string
          display_name: string
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
        }
        Insert: {
          created_at?: string
          display_name: string
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
        }
        Update: {
          created_at?: string
          display_name?: string
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
          aconex_comments: string | null
          actual_closure_date: string | null
          actual_completion_date: string | null
          actual_progress_pct: number | null
          actual_start_date: string | null
          area_level: string | null
          area_location: string | null
          area_type: string | null
          assigned_to: string | null
          captured_by_name: string | null
          category: string | null
          classification: string | null
          classification_source: string | null
          classified_at: string | null
          closure_status: string | null
          completion_status: string | null
          created_at: string
          created_by_name: string | null
          created_by_team_name: string | null
          created_date: string | null
          critical_marked_at: string | null
          critical_marked_by: string | null
          custom_payload: Json
          data_date: string | null
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
          location_raw: string | null
          location_reference: string | null
          main_trade: string | null
          plan_group: string | null
          plan_title: string | null
          planned_closure_date: string | null
          planned_completion_date: string | null
          planned_progress_pct: number | null
          planned_start_date: string | null
          podium_area: string | null
          priority: string | null
          priority_locked: boolean
          raw_payload: Json
          remarks: string | null
          row_version: number
          source_import_log_id: string | null
          source_issue_no: string
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
          aconex_comments?: string | null
          actual_closure_date?: string | null
          actual_completion_date?: string | null
          actual_progress_pct?: number | null
          actual_start_date?: string | null
          area_level?: string | null
          area_location?: string | null
          area_type?: string | null
          assigned_to?: string | null
          captured_by_name?: string | null
          category?: string | null
          classification?: string | null
          classification_source?: string | null
          classified_at?: string | null
          closure_status?: string | null
          completion_status?: string | null
          created_at?: string
          created_by_name?: string | null
          created_by_team_name?: string | null
          created_date?: string | null
          critical_marked_at?: string | null
          critical_marked_by?: string | null
          custom_payload?: Json
          data_date?: string | null
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
          location_raw?: string | null
          location_reference?: string | null
          main_trade?: string | null
          plan_group?: string | null
          plan_title?: string | null
          planned_closure_date?: string | null
          planned_completion_date?: string | null
          planned_progress_pct?: number | null
          planned_start_date?: string | null
          podium_area?: string | null
          priority?: string | null
          priority_locked?: boolean
          raw_payload?: Json
          remarks?: string | null
          row_version?: number
          source_import_log_id?: string | null
          source_issue_no: string
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
          aconex_comments?: string | null
          actual_closure_date?: string | null
          actual_completion_date?: string | null
          actual_progress_pct?: number | null
          actual_start_date?: string | null
          area_level?: string | null
          area_location?: string | null
          area_type?: string | null
          assigned_to?: string | null
          captured_by_name?: string | null
          category?: string | null
          classification?: string | null
          classification_source?: string | null
          classified_at?: string | null
          closure_status?: string | null
          completion_status?: string | null
          created_at?: string
          created_by_name?: string | null
          created_by_team_name?: string | null
          created_date?: string | null
          critical_marked_at?: string | null
          critical_marked_by?: string | null
          custom_payload?: Json
          data_date?: string | null
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
          location_raw?: string | null
          location_reference?: string | null
          main_trade?: string | null
          plan_group?: string | null
          plan_title?: string | null
          planned_closure_date?: string | null
          planned_completion_date?: string | null
          planned_progress_pct?: number | null
          planned_start_date?: string | null
          podium_area?: string | null
          priority?: string | null
          priority_locked?: boolean
          raw_payload?: Json
          remarks?: string | null
          row_version?: number
          source_import_log_id?: string | null
          source_issue_no?: string
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
      hdec_pic_master: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          hdec_pic_name: string | null
          id: string
          is_active: boolean
          login_id: string
          must_change_password: boolean
          subcontractor_name: string | null
          updated_at: string
          user_type: Database["public"]["Enums"]["user_type"]
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          hdec_pic_name?: string | null
          id: string
          is_active?: boolean
          login_id: string
          must_change_password?: boolean
          subcontractor_name?: string | null
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"]
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          hdec_pic_name?: string | null
          id?: string
          is_active?: boolean
          login_id?: string
          must_change_password?: boolean
          subcontractor_name?: string | null
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"]
        }
        Relationships: []
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
          field_name: string
          group_key: string | null
          id: string
          is_visible: boolean
          note: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          display_name: string
          field_name: string
          group_key?: string | null
          id?: string
          is_visible?: boolean
          note?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          display_name?: string
          field_name?: string
          group_key?: string | null
          id?: string
          is_visible?: boolean
          note?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
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
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      task_management_field_config: {
        Row: {
          created_at: string
          display_name: string
          field_name: string
          group_key: string | null
          id: string
          is_visible: boolean
          note: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          field_name: string
          group_key?: string | null
          id?: string
          is_visible?: boolean
          note?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          field_name?: string
          group_key?: string | null
          id?: string
          is_visible?: boolean
          note?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
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
          auto_judgment: string | null
          auto_judgment_import: string | null
          category: string | null
          created_at: string
          data_date: string
          discipline: string
          floor_level: string | null
          forecast_end: string | null
          id: string
          imported_at: string
          imported_by: string | null
          is_active: boolean
          is_rollup: boolean
          level: string
          location: string | null
          parent_task_no: string | null
          pic: string | null
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
          auto_judgment?: string | null
          auto_judgment_import?: string | null
          category?: string | null
          created_at?: string
          data_date: string
          discipline: string
          floor_level?: string | null
          forecast_end?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          is_active?: boolean
          is_rollup?: boolean
          level: string
          location?: string | null
          parent_task_no?: string | null
          pic?: string | null
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
          auto_judgment?: string | null
          auto_judgment_import?: string | null
          category?: string | null
          created_at?: string
          data_date?: string
          discipline?: string
          floor_level?: string | null
          forecast_end?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          is_active?: boolean
          is_rollup?: boolean
          level?: string
          location?: string | null
          parent_task_no?: string | null
          pic?: string | null
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
          behind_late_gap: number
          behind_warn_gap: number
          id: string
          slip_late_days: number
          slip_warn_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          behind_late_gap?: number
          behind_warn_gap?: number
          id?: string
          slip_late_days?: number
          slip_warn_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          behind_late_gap?: number
          behind_warn_gap?: number
          id?: string
          slip_late_days?: number
          slip_warn_days?: number
          updated_at?: string
          updated_by?: string | null
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
      [_ in never]: never
    }
    Functions: {
      allocate_task_no: {
        Args: { _discipline: string; _parent_task_no: string }
        Returns: string
      }
      calc_auto_judgment_value: {
        Args: {
          _actual_progress: number
          _plan_end: string
          _plan_start: string
          _slip_days: number
        }
        Returns: string
      }
      delete_defect_import_batch: { Args: { _batch_id: string }; Returns: Json }
      delete_spare_part_import_batch: {
        Args: { _batch_id: string }
        Returns: Json
      }
      delete_task_management_import_batch: {
        Args: { _batch_id: string }
        Returns: Json
      }
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
      is_admin_or_super: { Args: { _user_id: string }; Returns: boolean }
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
      resolve_login_email: { Args: { _login_id: string }; Returns: string }
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
      rollup_task_all_parents: {
        Args: { _discipline: string }
        Returns: number
      }
      update_task_summary: {
        Args: { _discipline: string; _parent_task_no: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "superuser" | "user" | "guest"
      user_type: "subcontractor" | "hdec" | "pm_pd" | "admin"
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
      app_role: ["admin", "superuser", "user", "guest"],
      user_type: ["subcontractor", "hdec", "pm_pd", "admin"],
    },
  },
} as const
