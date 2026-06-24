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
      document_chunks: {
        Row: {
          id: string;
          content: string;
          embedding: string;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          content: string;
          embedding: string;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          id?: string;
          content?: string;
          embedding?: string;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      match_chunks: {
        Args: {
          query_embedding: number[];
          match_threshold?: number;
          match_count?: number;
        };
        Returns: {
          id: string;
          content: string;
          metadata: Record<string, unknown> | null;
          similarity: number;
        }[];
      };
      match_chunks_keyword: {
        Args: {
          search_query: string;
          match_count?: number;
        };
        Returns: {
          id: string;
          content: string;
          metadata: Record<string, unknown> | null;
          rank: number;
        }[];
      };
      list_ingested_documents: {
        Args: Record<string, never>;
        Returns: {
          source: string;
          document_title: string | null;
          chunk_count: number;
          first_ingested_at: string;
          last_ingested_at: string;
        }[];
      };
      delete_ingested_document: {
        Args: {
          p_source: string;
        };
        Returns: number;
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
