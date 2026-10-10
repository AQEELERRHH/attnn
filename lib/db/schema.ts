import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("role", ["creator", "bidder", "both"]);
export const walletStateEnum = pgEnum("wallet_state", [
  "pending",
  "active",
  "failed",
]);
// Bid lifecycle:
//   placing ─┬─► pending (escrowed on-chain, onChainBidId known) ─┬─► accepted
//            │                                                     ├─► rejected
//            └─► failed (no USDC moved)                            ├─► refunded
//                                                                  └─► counter_offered (DB-only; still escrowed)
// accepted / rejected / refunded are written only after the settlement transaction
// is COMPLETE on-chain. While one is in flight the bid stays pending with
// settlementTxHash + settlementAction set ("confirming").
export const bidStatusEnum = pgEnum("bid_status", [
  "pending",
  "accepted",
  "rejected",
  "refunded",
  "counter_offered",
  "placing",
  "failed",
]);

export type BidStatus = (typeof bidStatusEnum.enumValues)[number];
export const agentLogActionEnum = pgEnum("agent_log_action", [
  "bid_placed",
  "bid_accepted",
  "bid_rejected",
  "creator_discovered",
  "creator_scored",
  "agent_started",
  "agent_stopped",
  "webhook_received",
  "auto_accept",
  "refund_claimed",
  "error",
]);

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  role: roleEnum("role").default("bidder").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const usersRelations = relations(users, ({ many }) => ({
  wallets: many(wallets),
  profiles: many(profiles),
  bidderConfigs: many(bidderConfigs),
  bidsAsBidder: many(bids, { relationName: "bids_bidder" }),
  bidsAsCreator: many(bids, { relationName: "bids_creator" }),
  agentLogs: many(agentLogs),
}));

// ─── Wallets ─────────────────────────────────────────────────────────────────

export const wallets = pgTable("wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  circleWalletId: text("circle_wallet_id").notNull().unique(),
  address: text("address").notNull(),
  blockchain: text("blockchain").default("ARC-TESTNET").notNull(),
  state: walletStateEnum("state").default("pending").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const walletsRelations = relations(wallets, ({ one }) => ({
  user: one(users, {
    fields: [wallets.userId],
    references: [users.id],
  }),
}));

// ─── Profiles (Creator-specific) ─────────────────────────────────────────────

export const profiles = pgTable("profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  handle: text("handle").notNull().unique(),
  // Atomic USDC (6 decimals). Never below the escrow's MIN_BID ($5).
  minBid: text("min_bid").default("5000000").notNull(),
  // Public market photo. Null → show the handle's initial.
  avatarUrl: text("avatar_url"),
  tags: text("tags").array().default([]).notNull(),
  bio: text("bio"),
  profileURI: text("profile_uri"),
  autoAcceptThreshold: integer("auto_accept_threshold").default(0),
  autoReplyTemplate: text("auto_reply_template").default("Thanks for reaching out! I've reviewed your bid and I'm happy to connect. Looking forward to hearing more — reach out on WhatsApp: +2319023XXXXXXX"),
  // Circle id of the registerCreator transaction (or a "reserved:<ms>" sentinel while
  // it's being sent). isActive flips only once the registry confirms it: lib/registration.ts.
  onChainTx: text("on_chain_tx"),
  // Why the last registration attempt failed; null otherwise. Cleared on retry.
  registrationError: text("registration_error"),
  availabilityStatus: text("availability_status").default("available").notNull(),
  openTo: text("open_to").array().default([]).notNull(),
  isActive: boolean("is_active").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, {
    fields: [profiles.userId],
    references: [users.id],
  }),
}));

// ─── Bidder Configs ──────────────────────────────────────────────────────────

export const bidderConfigs = pgTable("bidder_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  goal: text("goal"),
  dailyBudget: text("daily_budget").default("50000000").notNull(),
  maxBidPerCreator: text("max_bid_per_creator").default("5000000").notNull(),
  agentName: text("agent_name"),
  minFitScore: integer("min_fit_score").default(5).notNull(),
  searchTags: text("search_tags").array().default([]).notNull(),
  defaultMessage: text("default_message"),
  isActive: boolean("is_active").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const bidderConfigsRelations = relations(bidderConfigs, ({ one }) => ({
  user: one(users, {
    fields: [bidderConfigs.userId],
    references: [users.id],
  }),
}));

// ─── Bids ────────────────────────────────────────────────────────────────────

export const bids = pgTable("bids", {
  id: uuid("id").defaultRandom().primaryKey(),
  onChainBidId: text("on_chain_bid_id"),
  bidderUserId: uuid("bidder_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  creatorUserId: uuid("creator_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  bidderAddress: text("bidder_address").notNull(),
  creatorAddress: text("creator_address").notNull(),
  amountUsdc: text("amount_usdc").notNull(),
  message: text("message"),
  isPrivate: boolean("is_private").default(false).notNull(),
  status: bidStatusEnum("status").default("pending").notNull(),
  score: integer("score"),
  reply: text("reply"),
  // Who wrote the reply: "creator" (typed it), "template" (their saved template,
  // sent by them or their agent) or "ai" (drafted by the creator agent). Null on
  // rows from before this column. See lib/reply-rules.ts.
  replySource: text("reply_source").$type<"creator" | "template" | "ai">(),
  // The bidder's verdict on a paid reply: 1 = worth it, -1 = not. Null = not rated.
  replyRating: integer("reply_rating"),
  replyRatedAt: timestamp("reply_rated_at", { withTimezone: true }),
  bidTxHash: text("bid_tx_hash"),
  settlementTxHash: text("settlement_tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  counterOfferAmount: text("counter_offer_amount"),
  onChainTxHash: text("on_chain_tx_hash"),
  settlementOnChainTxHash: text("settlement_on_chain_tx_hash"),
  // Escrow contract this bid lives in (lower-case). Bid ids restart at 1 in every
  // escrow deployment, so (escrowAddress, onChainBidId) is the real identity.
  // Null on rows created before this column existed.
  escrowAddress: text("escrow_address"),
  // Which settlement is in flight while settlementTxHash is set on a pending bid.
  settlementAction: text("settlement_action").$type<"accept" | "reject" | "refund">(),
  // Bumped each time a settlement transaction fails, so the retry gets a fresh
  // Circle idempotency key ("settle:<id>:<action>:<attempt>").
  settlementAttempt: integer("settlement_attempt").default(0).notNull(),
  // Why placement or the last settlement attempt failed (shown to the user).
  failReason: text("fail_reason"),
  // Set on a bid the bidder's agent placed at a creator's counter price: the
  // countered bid it replaces. Once this bid is escrowed, the original is
  // declined automatically so the bidder's USDC isn't locked twice.
  replacesBidId: uuid("replaces_bid_id").references((): AnyPgColumn => bids.id, { onDelete: "set null" }),
}, (t) => [
  uniqueIndex("bids_escrow_onchain_id_uq")
    .on(t.escrowAddress, t.onChainBidId)
    .where(sql`${t.escrowAddress} IS NOT NULL AND ${t.onChainBidId} IS NOT NULL`),
  index("bids_status_idx").on(t.status),
  index("bids_bidder_created_idx").on(t.bidderUserId, t.createdAt),
  // At most one re-bid per countered bid (also makes the counter handler idempotent).
  uniqueIndex("bids_replaces_bid_id_uq").on(t.replacesBidId).where(sql`${t.replacesBidId} IS NOT NULL`),
]);

export const bidsRelations = relations(bids, ({ one }) => ({
  bidder: one(users, {
    fields: [bids.bidderUserId],
    references: [users.id],
    relationName: "bids_bidder",
  }),
  creator: one(users, {
    fields: [bids.creatorUserId],
    references: [users.id],
    relationName: "bids_creator",
  }),
}));

// ─── Agent Logs ──────────────────────────────────────────────────────────────

export const agentLogs = pgTable("agent_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: agentLogActionEnum("action").notNull(),
  data: jsonb("data").default({}).notNull(),
  txHash: text("tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const agentLogsRelations = relations(agentLogs, ({ one }) => ({
  user: one(users, {
    fields: [agentLogs.userId],
    references: [users.id],
  }),
}));

// ─── Webhook Events ─────────────────────────────────────────────────────

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: text("source").notNull(),
  eventId: text("event_id").notNull(),
  payload: jsonb("payload").default({}).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── x402 payments ───────────────────────────────────────────────────────────
// One row per paid x402 request (e.g. an agent unlocking a creator profile via
// Circle Gateway). signatureHash makes retries idempotent: the same signed payment
// returns the same resource instead of being settled twice. Also the audit trail.

export const x402Payments = pgTable("x402_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  // sha256 of the Payment-Signature header
  signatureHash: text("signature_hash").notNull().unique(),
  resource: text("resource").notNull(),
  payer: text("payer").notNull(),
  amountUsdc: text("amount_usdc").notNull(),
  network: text("network").notNull(),
  // Gateway settlement reference returned by the facilitator
  transaction: text("transaction").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("x402_payments_resource_idx").on(t.resource, t.createdAt)]);

// ─── Sessions (NextAuth) ─────────────────────────────────────────────────────

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
  sessionToken: text("session_token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

// ─── Accounts (NextAuth) ─────────────────────────────────────────────────────

export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refreshToken: text("refresh_token"),
  accessToken: text("access_token"),
  expiresAt: integer("expires_at"),
  tokenType: text("token_type"),
  scope: text("scope"),
  idToken: text("id_token"),
  sessionState: text("session_state"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

// ─── Verification Tokens ─────────────────────────────────────────────────────

export const verificationTokens = pgTable("verification_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  identifier: text("identifier").notNull(),
  token: text("token").notNull().unique(),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
