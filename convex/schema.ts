import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const roleUnion = v.union(
  v.literal("student"),
  v.literal("professional"),
  v.literal("intern"),
  v.literal("admin"),
);

const institutionalStatusUnion = v.union(
  v.literal("enabled"),
  v.literal("disabled"),
  v.literal("pending"),
);

const accountStatusUnion = v.union(v.literal("active"), v.literal("inactive"));

export default defineSchema({
  users: defineTable({
    email: v.string(),
    fullName: v.string(),
    role: roleUnion,
    institutionalStatus: institutionalStatusUnion,
    accountStatus: accountStatusUnion,
  })
    .index("by_email", ["email"])
    .index("by_role", ["role"])
    .index("by_institutional_status", ["institutionalStatus"]),
});
