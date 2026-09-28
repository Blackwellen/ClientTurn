/** One row of Admin -> Billing -> Scheduled deletions. Pure type, client-safe. */
export type AdminDeletionRow = {
  businessId: string;
  businessName: string;
  endedAt: string;
  day: number;
  deleteOn: string;
  noticeDay60At: string | null;
  noticeDay83At: string | null;
  hold: boolean;
  holdReason: string | null;
  deletionStartedAt: string | null;
  deletedAt: string | null;
  /** What the daily job would do today. */
  today: string;
};
