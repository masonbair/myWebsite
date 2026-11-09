export type NewsSource = {
  id: string;
  name: string;
  senderAddresses: string[];
  senderDomains: string[];
  homepage: string | null;
  archivePattern: string | null;
  public: boolean;
  active: boolean;
};

export type IssueStatus = "pending" | "processing" | "done" | "failed" | "quarantined" | "backfill";

export type NewIssue = {
  sourceId: string | null;
  messageId: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  publishedOn: string | null;
  rawPath: string;
  cleanText: string;
  publicUrl: string | null;
  status: IssueStatus;
};
