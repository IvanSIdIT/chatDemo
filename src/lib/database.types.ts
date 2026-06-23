export type UserRole = "worker" | "manager";
export type MessageStatus = "pending" | "reviewed";

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          id: string;
          email: string;
          role: UserRole;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          role: UserRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          role?: UserRole;
          created_at?: string;
        };
        Relationships: [];
      };
      employee_messages: {
        Row: {
          id: string;
          employee_id: string;
          content: string;
          status: MessageStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id?: string;
          content: string;
          status?: MessageStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          content?: string;
          status?: MessageStatus;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Enums: {
      user_role: UserRole;
      message_status: MessageStatus;
    };
  };
};

export type Account = Database["public"]["Tables"]["accounts"]["Row"];
export type EmployeeMessage = Database["public"]["Tables"]["employee_messages"]["Row"];
export type EmployeeMessageInsert = Database["public"]["Tables"]["employee_messages"]["Insert"];
