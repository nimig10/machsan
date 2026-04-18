export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          entity: string | null
          entity_id: string | null
          id: number
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: number
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: number
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      auth_entity_map: {
        Row: {
          auth_user_id: string
          created_at: string
          email: string
          entity_id: string
          entity_type: string
          id: string
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          email: string
          entity_id: string
          entity_type: string
          id?: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          email?: string
          entity_id?: string
          entity_type?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      equipment: {
        Row: {
          available_units: number | null
          category: string | null
          certification_id: string | null
          created_at: string | null
          description: string | null
          id: string
          image: string | null
          name: string
          notes: string | null
          photo_only: boolean | null
          private_loan_unlimited: boolean | null
          sound_only: boolean | null
          status: string | null
          technical_details: string | null
          total_quantity: number | null
          updated_at: string | null
        }
        Insert: {
          available_units?: number | null
          category?: string | null
          certification_id?: string | null
          created_at?: string | null
          description?: string | null
          id: string
          image?: string | null
          name: string
          notes?: string | null
          photo_only?: boolean | null
          private_loan_unlimited?: boolean | null
          sound_only?: boolean | null
          status?: string | null
          technical_details?: string | null
          total_quantity?: number | null
          updated_at?: string | null
        }
        Update: {
          available_units?: number | null
          category?: string | null
          certification_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image?: string | null
          name?: string
          notes?: string | null
          photo_only?: boolean | null
          private_loan_unlimited?: boolean | null
          sound_only?: boolean | null
          status?: string | null
          technical_details?: string | null
          total_quantity?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      equipment_reports: {
        Row: {
          content: string
          created_at: string | null
          equipment_id: string
          id: string
          reservation_id: string
          status: string
          student_name: string
        }
        Insert: {
          content: string
          created_at?: string | null
          equipment_id: string
          id?: string
          reservation_id: string
          status?: string
          student_name: string
        }
        Update: {
          content?: string
          created_at?: string | null
          equipment_id?: string
          id?: string
          reservation_id?: string
          status?: string
          student_name?: string
        }
        Relationships: []
      }
      equipment_units: {
        Row: {
          created_at: string | null
          equipment_id: string
          fault: string | null
          id: string
          repair: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          equipment_id: string
          fault?: string | null
          id: string
          repair?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          equipment_id?: string
          fault?: string | null
          id?: string
          repair?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_units_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_items: {
        Row: {
          created_at: string | null
          equipment_id: string | null
          id: number
          name: string | null
          quantity: number
          reservation_id: string
          unit_id: string | null
        }
        Insert: {
          created_at?: string | null
          equipment_id?: string | null
          id?: number
          name?: string | null
          quantity?: number
          reservation_id: string
          unit_id?: string | null
        }
        Update: {
          created_at?: string | null
          equipment_id?: string | null
          id?: number
          name?: string | null
          quantity?: number
          reservation_id?: string
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_items_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_items_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations_new"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations_new: {
        Row: {
          booking_kind: string | null
          borrow_date: string | null
          borrow_time: string | null
          course: string | null
          created_at: string | null
          crew_photographer_name: string | null
          crew_photographer_phone: string | null
          crew_sound_name: string | null
          crew_sound_phone: string | null
          email: string | null
          id: string
          lesson_auto: boolean | null
          lesson_id: string | null
          lesson_kit_id: string | null
          loan_type: string | null
          overdue_email_sent: boolean | null
          overdue_notified: boolean | null
          phone: string | null
          project_name: string | null
          return_date: string | null
          return_time: string | null
          returned_at: string | null
          sound_day_loan: boolean | null
          sound_night_loan: boolean | null
          status: string | null
          student_name: string | null
          studio_booking_id: string | null
          submitted_at: string | null
          updated_at: string | null
        }
        Insert: {
          booking_kind?: string | null
          borrow_date?: string | null
          borrow_time?: string | null
          course?: string | null
          created_at?: string | null
          crew_photographer_name?: string | null
          crew_photographer_phone?: string | null
          crew_sound_name?: string | null
          crew_sound_phone?: string | null
          email?: string | null
          id: string
          lesson_auto?: boolean | null
          lesson_id?: string | null
          lesson_kit_id?: string | null
          loan_type?: string | null
          overdue_email_sent?: boolean | null
          overdue_notified?: boolean | null
          phone?: string | null
          project_name?: string | null
          return_date?: string | null
          return_time?: string | null
          returned_at?: string | null
          sound_day_loan?: boolean | null
          sound_night_loan?: boolean | null
          status?: string | null
          student_name?: string | null
          studio_booking_id?: string | null
          submitted_at?: string | null
          updated_at?: string | null
        }
        Update: {
          booking_kind?: string | null
          borrow_date?: string | null
          borrow_time?: string | null
          course?: string | null
          created_at?: string | null
          crew_photographer_name?: string | null
          crew_photographer_phone?: string | null
          crew_sound_name?: string | null
          crew_sound_phone?: string | null
          email?: string | null
          id?: string
          lesson_auto?: boolean | null
          lesson_id?: string | null
          lesson_kit_id?: string | null
          loan_type?: string | null
          overdue_email_sent?: boolean | null
          overdue_notified?: boolean | null
          phone?: string | null
          project_name?: string | null
          return_date?: string | null
          return_time?: string | null
          returned_at?: string | null
          sound_day_loan?: boolean | null
          sound_night_loan?: boolean | null
          status?: string | null
          student_name?: string | null
          studio_booking_id?: string | null
          submitted_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      staff_daily_tasks: {
        Row: {
          assigned_by: string | null
          created_at: string | null
          date: string
          id: string
          locked: boolean | null
          staff_id: string
          task_key: string
          updated_at: string | null
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string | null
          date: string
          id?: string
          locked?: boolean | null
          staff_id: string
          task_key: string
          updated_at?: string | null
        }
        Update: {
          assigned_by?: string | null
          created_at?: string | null
          date?: string
          id?: string
          locked?: boolean | null
          staff_id?: string
          task_key?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      staff_members: {
        Row: {
          created_at: string | null
          email: string
          full_name: string
          id: string
          password_hash: string
          permissions: Json
          role: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          password_hash: string
          permissions?: Json
          role?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          password_hash?: string
          permissions?: Json
          role?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      staff_schedule_assignments: {
        Row: {
          assigned_by: string | null
          created_at: string | null
          date: string
          end_time: string | null
          id: string
          locked: boolean | null
          note: string | null
          note_public: boolean | null
          shift_type: string
          source: string | null
          staff_id: string
          start_time: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string | null
          date: string
          end_time?: string | null
          id?: string
          locked?: boolean | null
          note?: string | null
          note_public?: boolean | null
          shift_type: string
          source?: string | null
          staff_id: string
          start_time?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_by?: string | null
          created_at?: string | null
          date?: string
          end_time?: string | null
          id?: string
          locked?: boolean | null
          note?: string | null
          note_public?: boolean | null
          shift_type?: string
          source?: string | null
          staff_id?: string
          start_time?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_schedule_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_schedule_preferences: {
        Row: {
          created_at: string | null
          date: string
          end_time: string | null
          id: string
          note: string | null
          note_public: boolean | null
          shift_type: string
          staff_id: string
          start_time: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          end_time?: string | null
          id?: string
          note?: string | null
          note_public?: boolean | null
          shift_type: string
          staff_id: string
          start_time?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          end_time?: string | null
          id?: string
          note?: string | null
          note_public?: boolean | null
          shift_type?: string
          staff_id?: string
          start_time?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_schedule_preferences_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      store: {
        Row: {
          data: Json | null
          key: string
          updated_at: string | null
        }
        Insert: {
          data?: Json | null
          key: string
          updated_at?: string | null
        }
        Update: {
          data?: Json | null
          key?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      store_snapshots: {
        Row: {
          blocked: boolean
          data: Json
          id: number
          key: string
          new_len: number | null
          note: string | null
          prev_len: number | null
          taken_at: string
        }
        Insert: {
          blocked?: boolean
          data: Json
          id?: number
          key: string
          new_len?: number | null
          note?: string | null
          prev_len?: number | null
          taken_at?: string
        }
        Update: {
          blocked?: boolean
          data?: Json
          id?: number
          key?: string
          new_len?: number | null
          note?: string | null
          prev_len?: number | null
          taken_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_admin: boolean
          is_lecturer: boolean
          is_push_enabled: boolean
          is_student: boolean
          is_warehouse: boolean
          permissions: Json | null
          phone: string | null
          push_subscription: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_admin?: boolean
          is_lecturer?: boolean
          is_push_enabled?: boolean
          is_student?: boolean
          is_warehouse?: boolean
          permissions?: Json | null
          phone?: string | null
          push_subscription?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_admin?: boolean
          is_lecturer?: boolean
          is_push_enabled?: boolean
          is_student?: boolean
          is_warehouse?: boolean
          permissions?: Json | null
          phone?: string | null
          push_subscription?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      append_to_store_reservations: {
        Args: { p_reservation: Json }
        Returns: undefined
      }
      check_migration_drift: { Args: never; Returns: Json }
      create_lesson_reservations_v1: {
        Args: { p_items: Json; p_kit_id: string; p_reservations: Json }
        Returns: Json
      }
      create_reservation_v2: {
        Args: { p_items: Json; p_reservation: Json }
        Returns: string
      }
      delete_reservation_v1: {
        Args: { p_reservation_id: string }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_protected_store_key: { Args: { p_key: string }; Returns: boolean }
      is_staff_member: { Args: never; Returns: boolean }
      mark_overdue_email_sent: { Args: { p_id: string }; Returns: undefined }
      prune_store_snapshots: { Args: { p_keep_days?: number }; Returns: number }
      sync_equipment_from_json: { Args: { p_equipment: Json }; Returns: Json }
      sync_reservations_from_json: {
        Args: { p_reservations: Json }
        Returns: Json
      }
      update_reservation_status_v1: {
        Args: {
          p_new_status: string
          p_reservation_id: string
          p_returned_at?: string
        }
        Returns: Json
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
    Enums: {},
  },
} as const
