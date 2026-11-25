// Datenmodell als JSDoc. Alle anderen Dateien importieren ihre Typen von hier.

/**
 * @typedef {{ url: string, text: string }} Page
 * @typedef {"offering" | "customers" | "pricing"} Topic
 * @typedef {"model" | "user" | "test"} ClaimSource
 * @typedef {{ url: unknown, quote: unknown, topic: unknown, source: ClaimSource }} Claim
 * @typedef {{ id: string, url: string, quote: string, topic: Topic, source: ClaimSource }} Fact
 * @typedef {"no_quote" | "quote_length" | "unknown_url" | "not_on_page" | "unknown_topic"
 *   | "bad_shape" | "unknown_segment" | "struck_segment" | "unknown_signal_type"
 *   | "unknown_category" | "too_long" | "subject_too_long" | "unproven_customer" | "no_keywords"} DropReason
 * @typedef {{ item: unknown, reason: DropReason, detail: string }} Dropped
 * @typedef {{ id: string, name: string, industry: string, subIndustry: string, why: string,
 *   struck?: boolean, strikeReason?: string }} Segment
 * @typedef {{ id: string, segmentId: string, title: string, measuredOn: string[], problems: string[] }} Persona
 * @typedef {"hiring" | "funding" | "new_sales_leader" | "tech_stack"} SignalType
 * @typedef {{ id: string, kind: "source", segmentId: string, name: string, why: string }} Source
 * @typedef {{ id: string, kind: "signal", segmentId: string, type: SignalType, description: string }} Signal
 * @typedef {{ id: string, segmentId: string, keywords: string[] }} Keyword
 * @typedef {"make_money" | "save_money" | "save_time" | "reduce_risk"} OfferCategory
 * @typedef {{ subject: string, body: string }} Email
 * @typedef {{ id: string, segmentId: string, category: OfferCategory, idea: string, email: Email }} Offer
 * @typedef {Fact | Segment | Persona | Source | Signal | Keyword | Offer} Item
 * @typedef {"empty" | "draft" | "approved" | "stale"} Status
 * @typedef {{ status: Status, items: Item[], dropped: Dropped[] }} StepState
 * @typedef {1 | 2 | 3 | 4 | 5 | 6} StepNo
 * @typedef {{ domain: string, pages: Page[], seq: number, steps: Record<StepNo, StepState> }} State
 */

/** @type {readonly StepNo[]} */
export const STEPS = Object.freeze([1, 2, 3, 4, 5, 6]);
