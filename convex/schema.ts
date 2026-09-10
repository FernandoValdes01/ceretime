import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    fullName: v.string(),
    role: v.union(
      v.literal("student"),
      v.literal("professional"),
      v.literal("intern"),
      v.literal("admin")
    ),
    institutionalStatus: v.union(
      v.literal("enabled"),
      v.literal("disabled"),
      v.literal("pending")
    ),
    accountStatus: v.union(
      v.literal("active"),
      v.literal("inactive")
    ),
  })
    .index("by_email", ["email"])
    .index("by_role", ["role"])
    .index("by_institutional_status", ["institutionalStatus"]),
});