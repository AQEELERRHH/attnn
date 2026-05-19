import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("role", ["creator", "bidder", "both"]);
export const walletStateEnum = pgEnum("wallet_state", [
  "pending",
  "active",
  "failed",
]);
export const bidStatusEnum = pgEnum("bid_status", [
  "pending",
  "accepted",
  "rejected",
  "refunded",
]);
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
  minBid: text("min_bid").default("1000000").notNull(),
  tags: text("tags").array().default([]).notNull(),
  bio: text("bio"),
  profileURI: text("profile_uri"),
  autoAcceptThreshold: integer("auto_accept_threshold").default(0),
  onChainTx: text("on_chain_tx"),
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
  bidTxHash: text("bid_tx_hash"),
  settlementTxHash: text("settlement_tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

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
