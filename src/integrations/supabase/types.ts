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
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
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
          issue_internal: string | null
          issue_owner: string | null
          issue_supplier: string | null
          issue_technical: string | null
          manual_available: boolean | null
          manufacturer: string | null
          phy: boolean | null
          physical_list_agreed: boolean | null
          physical_remarks: string | null
          physical_supply: boolean | null
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
          issue_internal?: string | null
          issue_owner?: string | null
          issue_supplier?: string | null
          issue_technical?: string | null
          manual_available?: boolean | null
          manufacturer?: string | null
          phy?: boolean | null
          physical_list_agreed?: boolean | null
          physical_remarks?: string | null
          physical_supply?: boolean | null
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
          issue_internal?: string | null
          issue_owner?: string | null
          issue_supplier?: string | null
          issue_technical?: string | null
          manual_available?: boolean | null
          manufacturer?: string | null
          phy?: boolean | null
          physical_list_agreed?: boolean | null
          physical_remarks?: string | null
          physical_supply?: boolean | null
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
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_super: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "superuser" | "user"
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
      app_role: ["admin", "superuser", "user"],
    },
  },
} as const
