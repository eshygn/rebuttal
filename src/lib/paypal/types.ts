/** Subsets of the documented PayPal response shapes that Rebuttal reads. Field names are PayPal's. */
export type PPMoney = { currency_code: string; value: string };
export type PPLink = { href: string; rel: string; method: string };

export type DisputeReason =
  | "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
  | "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
  | "UNAUTHORISED"
  | "CREDIT_NOT_PROCESSED"
  | "DUPLICATE_TRANSACTION"
  | "INCORRECT_AMOUNT"
  | "PAYMENT_BY_OTHER_MEANS"
  | "CANCELED_RECURRING_BILLING"
  | "PROBLEM_WITH_REMITTANCE"
  | "OTHER";

export type DisputeStatus =
  | "OPEN"
  | "WAITING_FOR_BUYER_RESPONSE"
  | "WAITING_FOR_SELLER_RESPONSE"
  | "UNDER_REVIEW"
  | "RESOLVED"
  | "OTHER";

export type DisputeStage = "INQUIRY" | "CHARGEBACK" | "PRE_ARBITRATION" | "ARBITRATION";

export type PPEvidence = {
  evidence_type: string;
  evidence_info?: {
    tracking_info?: { carrier_name: string; carrier_name_other?: string; tracking_number: string; tracking_url?: string }[];
    refund_ids?: { refund_id: string }[];
  };
  documents?: { name: string; url?: string }[];
  notes?: string;
  source?: string;
  date?: string;
};

export type PPDispute = {
  dispute_id: string;
  create_time: string;
  update_time: string;
  disputed_transactions?: {
    buyer_transaction_id?: string;
    seller_transaction_id?: string;
    create_time?: string;
    transaction_status?: string;
    gross_amount?: PPMoney;
    invoice_number?: string;
    custom?: string;
    buyer?: { name?: string; email?: string; payer_id?: string };
    seller?: { email?: string; merchant_id?: string; name?: string };
    items?: { item_name?: string; item_description?: string; item_quantity?: string; item_id?: string }[];
    seller_protection_eligible?: boolean;
  }[];
  reason: DisputeReason;
  status: DisputeStatus;
  dispute_amount: PPMoney;
  dispute_outcome?: { outcome_code: string; amount_refunded?: PPMoney };
  dispute_life_cycle_stage?: DisputeStage;
  dispute_channel?: string;
  dispute_state?: string;
  seller_response_due_date?: string;
  buyer_response_due_date?: string;
  messages?: { posted_by: string; time_posted: string; content: string }[];
  offer?: {
    buyer_requested_amount?: PPMoney;
    seller_offered_amount?: PPMoney;
    offer_type?: string;
    history?: { offer_time: string; actor: string; event_type: string; offer_type: string; offer_amount?: PPMoney }[];
  };
  evidences?: PPEvidence[];
  extensions?: Record<string, unknown>;
  links: PPLink[];
};

export type PPDisputeList = {
  items: Pick<
    PPDispute,
    "dispute_id" | "create_time" | "update_time" | "reason" | "status" | "dispute_state" | "dispute_amount" | "dispute_life_cycle_stage" | "links"
  >[];
  links: PPLink[];
};

export type PPSubsequentAction = { links: PPLink[] };

export function hasLink(d: { links?: PPLink[] }, rel: string): boolean {
  return !!d.links?.some((l) => l.rel === rel);
}

export function disputeIdFromLinks(r: { links?: PPLink[] }): string | undefined {
  const href = r.links?.find((l) => /\/v1\/customer\/disputes\/[^/]+$/.test(l.href))?.href;
  return href?.split("/").pop();
}
